-- Families (groups of projects) and a per-semester points competition between
-- them.
--
-- Three new tables and one new column on `projects`:
--
--   families       the ~4 named groups. Presentation columns (icon/icon_url/
--                  color) deliberately mirror `projects` (0031) so IconPicker,
--                  ColorPicker and the portal-color accent helpers work unchanged.
--   projects.family_id  a project belongs to at most one family.
--   semesters      the scoring window. At most one is active at a time.
--   score_entries  the points ledger. Exec awards points to a PROJECT; a
--                  family's score is the live sum over its projects.
--
-- Why a column on `projects` and not a join table: a project belongs to exactly
-- one family, so a join table would need a unique(project_id) index to say the
-- same thing with an extra join, a second set of policies and a second write
-- path. `on delete set null` so dropping a family never deletes projects or
-- their history.
--
-- Why nothing is denormalized: a family's total is computed on read by
-- family_standings() below. A stored total would need keeping in sync on award,
-- on void AND on project reassignment — three places to drift, for 4 families
-- and a few hundred ledger rows a semester. There are no views anywhere in this
-- schema, so SECURITY DEFINER table-returning functions are the idiom here
-- (application_analytics() 0060, application_period_stats() 0053).
--
-- The accepted consequence of deriving family totals from the project's CURRENT
-- assignment: moving a project between families mid-semester moves its whole
-- point history with it. That is what "a family's points are the sum of its
-- projects' points" means, and the alternative (freezing family_id onto every
-- ledger row) makes the ledger disagree with the Families tab the moment a
-- project is reassigned. The admin UI warns before a reassignment.
--
-- Why score_entries has NO write policy at all: see the RLS section. The only
-- writers are award_score() and void_score_entry(), which makes "append-only,
-- auditable" a property of the schema rather than of the UI.
--
-- Why is_exec() and never is_board_or_exec(): per 0016, "board" folds in PMs, so
-- a board gate would let a PM award points to their own project.

-- 1. Families ----------------------------------------------------------------

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  icon        text,
  icon_url    text,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Two families called "Red" is always a mistake.
create unique index if not exists families_name_lower_idx
  on public.families (lower(name));

alter table public.projects
  add column if not exists family_id uuid references public.families(id) on delete set null;

create index if not exists projects_family_id_idx
  on public.projects (family_id) where family_id is not null;

-- 0017 widened the projects UPDATE policy to a project's PMs, so without this a
-- PM could move their own project into whichever family is winning. Same shape
-- as 0019's guard on `type`, kept as a separate trigger so re-running 0019 stays
-- safe.
create or replace function public.projects_guard_family_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.family_id is distinct from old.family_id and not public.is_exec() then
    raise exception 'Only exec can change a project''s family.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_family_change on public.projects;
create trigger projects_guard_family_change
before update on public.projects
for each row execute function public.projects_guard_family_change();

-- 2. Semesters ---------------------------------------------------------------
--
-- Deliberately independent of `application_periods` (0022): that models a
-- recruiting cycle with draft/open/closed applicant-facing semantics, so
-- reusing it would make "the active semester" mean "whichever cycle is
-- accepting applications" — i.e. nothing, for most of the term.

create table if not exists public.semesters (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_on  date,
  ends_on    date,
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists semesters_name_lower_idx
  on public.semesters (lower(name));

-- At most one active semester, enforced by the database rather than by the UI:
-- every row in this partial index has is_active = true, so uniqueness on that
-- column means at most one such row can exist. "At most", not "exactly" — a
-- fresh database with no semester is legal and the scoreboard renders an empty
-- state for it.
create unique index if not exists semesters_one_active_idx
  on public.semesters (is_active) where is_active;

create or replace function public.active_semester_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.semesters where is_active limit 1;
$$;

-- 3. The ledger --------------------------------------------------------------

create table if not exists public.score_entries (
  id          uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters(id) on delete restrict,
  project_id  uuid not null references public.projects(id)  on delete cascade,
  points      integer not null,
  reason      text not null,
  awarded_on  date not null default current_date,
  awarded_by  uuid references public.members(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid references public.members(user_id) on delete set null,
  constraint score_entries_nonzero    check (points <> 0),
  constraint score_entries_magnitude  check (points between -10000 and 10000),
  constraint score_entries_reason_len check (char_length(btrim(reason)) between 1 and 500),
  constraint score_entries_void_pair  check ((voided_at is null) = (voided_by is null))
);

-- The hot path: sum live points for one semester, grouped by project.
create index if not exists score_entries_semester_project_live_idx
  on public.score_entries (semester_id, project_id) where voided_at is null;

-- The audit feed: newest first within a semester.
create index if not exists score_entries_semester_recent_idx
  on public.score_entries (semester_id, created_at desc);

-- Notes on the shape:
--   * points may be NEGATIVE — penalties are a real thing exec will want, and a
--     separate table or a kind enum doubles the schema for no gain. Zero is
--     rejected because a zero award is noise.
--   * awarded_on (the day the thing happened, exec-editable) is separate from
--     created_at (when the row was written, immutable). The feed sorts by
--     created_at; the UI displays awarded_on.
--   * a correction is a VOID, not an offsetting row. A void keeps exactly one
--     row per real-world event, renders struck-through in the audit view, and
--     drops out of every sum. An offsetting -50 row would inflate award_count
--     and force the reader to pair rows mentally. The original amount, reason,
--     date and awarder stay readable.

-- 4. RLS ---------------------------------------------------------------------
--
-- RLS is the only authorization layer here — the browser client reads these
-- tables directly. Every policy is per-command (never `for all`) and wraps its
-- row-independent helper in a scalar subquery so Postgres hoists it into a
-- once-per-query InitPlan instead of re-evaluating per row; 0090 documents why
-- at length (unwrapped helpers were burning 74% of all database CPU). There is
-- exactly one permissive SELECT policy per table, so nothing gets OR'd and
-- re-expanded per row.

alter table public.families      enable row level security;
alter table public.semesters     enable row level security;
alter table public.score_entries enable row level security;

-- families: every signed-in member reads the standings; exec manages.

drop policy if exists "families_select" on public.families;
create policy "families_select"
on public.families
for select
to authenticated
using ( true );

drop policy if exists "families_insert" on public.families;
create policy "families_insert"
on public.families
for insert
to authenticated
with check ( (select public.is_exec()) );

drop policy if exists "families_update" on public.families;
create policy "families_update"
on public.families
for update
to authenticated
using      ( (select public.is_exec()) )
with check ( (select public.is_exec()) );

drop policy if exists "families_delete" on public.families;
create policy "families_delete"
on public.families
for delete
to authenticated
using ( (select public.is_exec()) );

-- semesters: the scoreboard needs the active one's name and the switcher needs
-- the list, so SELECT is open to any member.

drop policy if exists "semesters_select" on public.semesters;
create policy "semesters_select"
on public.semesters
for select
to authenticated
using ( true );

drop policy if exists "semesters_insert" on public.semesters;
create policy "semesters_insert"
on public.semesters
for insert
to authenticated
with check ( (select public.is_exec()) );

drop policy if exists "semesters_update" on public.semesters;
create policy "semesters_update"
on public.semesters
for update
to authenticated
using      ( (select public.is_exec()) )
with check ( (select public.is_exec()) );

drop policy if exists "semesters_delete" on public.semesters;
create policy "semesters_delete"
on public.semesters
for delete
to authenticated
using ( (select public.is_exec()) );

-- score_entries: readable by every signed-in member, writable by nobody.
--
-- SELECT is open because the ledger is what makes the scoreboard credible —
-- every member can see which project got what, for what reason, from whom.
--
-- There is deliberately NO insert/update/delete policy. RLS default-denies, so
-- the browser client cannot write this table at all; the only writers are
-- award_score() and void_score_entry() below, which is what makes the ledger
-- genuinely append-only rather than append-only-by-convention.

drop policy if exists "score_entries_select" on public.score_entries;
create policy "score_entries_select"
on public.score_entries
for select
to authenticated
using ( true );

-- 5. Write RPCs --------------------------------------------------------------

-- Award (or deduct) points for one project in one semester. Returns the new
-- row's id so the client can prepend it optimistically.
create or replace function public.award_score(
  p_project_id  uuid,
  p_points      integer,
  p_reason      text,
  p_awarded_on  date default null,
  p_semester_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_semester_id uuid;
  v_id          uuid;
begin
  if not public.is_exec() then
    raise exception 'not authorized';
  end if;

  v_semester_id := coalesce(p_semester_id, public.active_semester_id());
  if v_semester_id is null then
    raise exception 'no active semester';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'project not found';
  end if;

  if p_points is null or p_points = 0 then
    raise exception 'points must be a non-zero number';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  insert into public.score_entries
    (semester_id, project_id, points, reason, awarded_on, awarded_by)
  values
    (v_semester_id, p_project_id, p_points, btrim(p_reason),
     coalesce(p_awarded_on, current_date), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Void an entry. The row is never edited or deleted — voiding drops it out of
-- every total while leaving the original amount, reason, date and awarder
-- readable in the audit view.
create or replace function public.void_score_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_exec() then
    raise exception 'not authorized';
  end if;

  update public.score_entries
  set voided_at = now(), voided_by = auth.uid()
  where id = p_entry_id and voided_at is null;

  if not found then
    raise exception 'entry not found, or already voided';
  end if;
end;
$$;

-- Switch the active semester atomically. A two-statement client-side version
-- would transiently violate semesters_one_active_idx depending on order, and
-- could leave no semester active at all if the second call failed.
create or replace function public.set_active_semester(p_semester_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_exec() then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from public.semesters where id = p_semester_id) then
    raise exception 'semester not found';
  end if;

  update public.semesters set is_active = false, updated_at = now()
  where is_active and id <> p_semester_id;

  update public.semesters set is_active = true, updated_at = now()
  where id = p_semester_id and not is_active;
end;
$$;

-- 6. Read RPCs ---------------------------------------------------------------
--
-- Two shapes rather than one flat join: family_standings carries the rank
-- window and must left-join so a family with no projects still appears at 0,
-- while project_scores is a different grain and surfaces projects with no
-- family. A single query would either lose empty families or need a null-padded
-- union the client has to re-split. They are fetched in one Promise.all.
--
-- p_semester_id defaults to the active semester when null/omitted.

-- One row per family, ranked. rank() (not row_number) so tied families share a
-- position — the podium needs to know about a tie.
create or replace function public.family_standings(p_semester_id uuid default null)
returns table (
  family_id     uuid,
  family_name   text,
  icon          text,
  icon_url      text,
  color         text,
  points        integer,
  project_count integer,
  award_count   integer,
  rank          integer
)
language sql
security definer
set search_path = public
stable
as $$
  with sem as (
    select coalesce(p_semester_id, public.active_semester_id()) as id
  ),
  totals as (
    select
      p.family_id,
      coalesce(sum(se.points), 0)::int as points,
      count(distinct p.id)::int        as project_count,
      count(se.id)::int                as award_count
    from public.projects p
    left join public.score_entries se
      on se.project_id = p.id
     and se.voided_at is null
     and se.semester_id = (select id from sem)
    where p.family_id is not null
    group by p.family_id
  )
  select
    f.id,
    f.name,
    f.icon,
    f.icon_url,
    f.color,
    coalesce(t.points, 0)::int,
    coalesce(t.project_count, 0)::int,
    coalesce(t.award_count, 0)::int,
    rank() over (order by coalesce(t.points, 0) desc)::int
  from public.families f
  left join totals t on t.family_id = f.id
  order by coalesce(t.points, 0) desc, f.name;
$$;

-- One row per project that either belongs to a family or has live points this
-- semester. family_id is null for the latter — that is how the Scoring tab
-- shows exec "these awards aren't counting for anyone yet".
create or replace function public.project_scores(p_semester_id uuid default null)
returns table (
  family_id    uuid,
  project_id   uuid,
  project_name text,
  icon         text,
  icon_url     text,
  color        text,
  points       integer,
  award_count  integer
)
language sql
security definer
set search_path = public
stable
as $$
  with sem as (
    select coalesce(p_semester_id, public.active_semester_id()) as id
  ),
  agg as (
    select
      p.family_id,
      p.id   as project_id,
      p.name as project_name,
      p.icon,
      p.icon_url,
      p.color,
      coalesce(sum(se.points), 0)::int as points,
      count(se.id)::int                as award_count
    from public.projects p
    left join public.score_entries se
      on se.project_id = p.id
     and se.voided_at is null
     and se.semester_id = (select id from sem)
    group by p.family_id, p.id, p.name, p.icon, p.icon_url, p.color
  )
  select
    agg.family_id, agg.project_id, agg.project_name,
    agg.icon, agg.icon_url, agg.color, agg.points, agg.award_count
  from agg
  where agg.family_id is not null or agg.award_count > 0
  order by agg.points desc, agg.project_name;
$$;

-- The audit feed. An RPC rather than a PostgREST join because the awarder's
-- name comes from `members` (own RLS) and the family comes through `projects`,
-- so a client-side version is two or three extra round trips plus a join to
-- assemble. Includes voided rows; the UI filters them behind a toggle.
create or replace function public.score_ledger(
  p_semester_id uuid default null,
  p_limit       integer default 50
)
returns table (
  id              uuid,
  project_id      uuid,
  project_name    text,
  family_id       uuid,
  family_name     text,
  family_color    text,
  points          integer,
  reason          text,
  awarded_on      date,
  awarded_by      uuid,
  awarded_by_name text,
  created_at      timestamptz,
  voided_at       timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    se.id,
    se.project_id,
    p.name,
    f.id,
    f.name,
    f.color,
    se.points,
    se.reason,
    se.awarded_on,
    se.awarded_by,
    nullif(btrim(coalesce(m.preferred_firstname, '') || ' ' || coalesce(m.lastname, '')), ''),
    se.created_at,
    se.voided_at
  from public.score_entries se
  join public.projects p on p.id = se.project_id
  left join public.families f on f.id = p.family_id
  left join public.members m on m.user_id = se.awarded_by
  where se.semester_id = coalesce(p_semester_id, public.active_semester_id())
  order by se.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- 7. Grants ------------------------------------------------------------------
--
-- `revoke ... from public, anon` and not just `from anon`: per 0097, revoking
-- from anon alone is a no-op because anon inherits the default PUBLIC grant.
-- The trigger function is deliberately left alone — triggers aren't callable.

revoke execute on function public.active_semester_id() from public, anon;
grant  execute on function public.active_semester_id() to authenticated;

revoke execute on function public.award_score(uuid, integer, text, date, uuid) from public, anon;
grant  execute on function public.award_score(uuid, integer, text, date, uuid) to authenticated;

revoke execute on function public.void_score_entry(uuid) from public, anon;
grant  execute on function public.void_score_entry(uuid) to authenticated;

revoke execute on function public.set_active_semester(uuid) from public, anon;
grant  execute on function public.set_active_semester(uuid) to authenticated;

revoke execute on function public.family_standings(uuid) from public, anon;
grant  execute on function public.family_standings(uuid) to authenticated;

revoke execute on function public.project_scores(uuid) from public, anon;
grant  execute on function public.project_scores(uuid) to authenticated;

revoke execute on function public.score_ledger(uuid, integer) from public, anon;
grant  execute on function public.score_ledger(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
