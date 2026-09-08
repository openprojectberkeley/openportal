-- Lets a project's PM (not just VP Tech/President/VP Projects) participate
-- in the draft from the Applications manager page: keep a wishlist of
-- applicants they want, stage picks for their upcoming round in a capped
-- "draft window", and submit those picks once it's their project's turn.
--
--   1. draft_round_projects.submitted_at: set once a round's picks are
--      submitted for that project -- distinguishes "still staging" (the
--      draft window) from "confirmed" for the same round_project row.
--   2. Widened SELECT policies: draft_rounds/draft_round_projects/
--      draft_state were previously readable only by can_review_all_projects()
--      (0070/0071). A PM needs to see round order, their own pick_count, and
--      whose turn it is, so add permissive SELECT policies (is_board_or_exec()
--      for the period-level draft_rounds/draft_state; can_review_project()
--      for the project-scoped draft_round_projects) alongside the existing
--      admin-only "for all" policies (RLS policies for the same command are
--      OR'd, so this only ever widens read access, never write).
--   3. draft_wishlist_entries: a PM's shortlist for their project, independent
--      of any specific round -- position is a plain reorder column (not
--      unique, same reasoning as draft_round_projects.pick_order in 0070).
--   4. draft_picks: which applicants are staged/confirmed for a specific
--      round_project_id. While draft_round_projects.submitted_at is null for
--      that row, its draft_picks rows ARE the draft window's contents; once
--      submitted, the same rows become that round's confirmed picks -- no
--      separate staging table needed. draft_picks_guard() (BEFORE INSERT)
--      enforces the round isn't already submitted and stays within pick_count.
--   5. submit_draft_picks(p_round_project_id): SECURITY DEFINER RPC --
--      requires can_review_project() on the round's project AND that it's
--      currently that round_project's turn (draft_state.current_pick_id).
--      Places every staged applicant via the existing accept_application()
--      (same placement logic/authorization as manual review) and marks the
--      round submitted. Deliberately does NOT advance draft_state -- an
--      exec/VP still moves the draft to the next pick from /manager/draft.

alter table public.draft_round_projects add column if not exists submitted_at timestamptz;

drop policy if exists "draft_rounds_select_board" on public.draft_rounds;
create policy "draft_rounds_select_board"
on public.draft_rounds
for select
to authenticated
using ( public.is_board_or_exec() );

drop policy if exists "draft_round_projects_select_reviewable" on public.draft_round_projects;
create policy "draft_round_projects_select_reviewable"
on public.draft_round_projects
for select
to authenticated
using ( public.can_review_project(project_id) );

drop policy if exists "draft_state_select_board" on public.draft_state;
create policy "draft_state_select_board"
on public.draft_state
for select
to authenticated
using ( public.is_board_or_exec() );

-- 3. A PM's per-project shortlist -----------------------------------------

create table if not exists public.draft_wishlist_entries (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  position       int not null,
  created_at     timestamptz not null default now(),
  unique (project_id, application_id)
);

create index if not exists draft_wishlist_entries_project_position_idx
  on public.draft_wishlist_entries(project_id, position);

alter table public.draft_wishlist_entries enable row level security;

drop policy if exists "draft_wishlist_entries_all" on public.draft_wishlist_entries;
create policy "draft_wishlist_entries_all"
on public.draft_wishlist_entries
for all
to authenticated
using ( public.can_review_project(project_id) )
with check ( public.can_review_project(project_id) );

-- 4. Staged/confirmed picks for one round_project turn ---------------------

create table if not exists public.draft_picks (
  id                uuid primary key default gen_random_uuid(),
  round_project_id  uuid not null references public.draft_round_projects(id) on delete cascade,
  application_id    uuid not null references public.applications(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (round_project_id, application_id)
);

create index if not exists draft_picks_round_project_idx on public.draft_picks(round_project_id);

alter table public.draft_picks enable row level security;

drop policy if exists "draft_picks_select" on public.draft_picks;
create policy "draft_picks_select"
on public.draft_picks
for select
to authenticated
using (
  exists (
    select 1 from public.draft_round_projects rp
    where rp.id = draft_picks.round_project_id
      and public.can_review_project(rp.project_id)
  )
);

drop policy if exists "draft_picks_insert" on public.draft_picks;
create policy "draft_picks_insert"
on public.draft_picks
for insert
to authenticated
with check (
  exists (
    select 1 from public.draft_round_projects rp
    where rp.id = draft_picks.round_project_id
      and public.can_review_project(rp.project_id)
  )
);

-- Staged picks can be un-staged; a confirmed (submitted) round's picks
-- can't be pulled back out through a raw delete.
drop policy if exists "draft_picks_delete" on public.draft_picks;
create policy "draft_picks_delete"
on public.draft_picks
for delete
to authenticated
using (
  exists (
    select 1 from public.draft_round_projects rp
    where rp.id = draft_picks.round_project_id
      and rp.submitted_at is null
      and public.can_review_project(rp.project_id)
  )
);

create or replace function public.draft_picks_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick_count int;
  v_submitted  timestamptz;
  v_current    int;
begin
  select rp.pick_count, rp.submitted_at
  into v_pick_count, v_submitted
  from public.draft_round_projects rp
  where rp.id = new.round_project_id;

  if v_submitted is not null then
    raise exception 'This round has already been submitted.';
  end if;

  select count(*) into v_current
  from public.draft_picks
  where round_project_id = new.round_project_id;

  if v_current >= v_pick_count then
    raise exception 'The draft window is full for this round.';
  end if;

  return new;
end;
$$;

drop trigger if exists draft_picks_guard_trigger on public.draft_picks;
create trigger draft_picks_guard_trigger
before insert on public.draft_picks
for each row execute function public.draft_picks_guard();

-- 5. Submit: place every staged applicant, mark the round submitted -------

create or replace function public.submit_draft_picks(p_round_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_application_id uuid;
begin
  select project_id into v_project_id
  from public.draft_round_projects
  where id = p_round_project_id;

  if v_project_id is null then
    raise exception 'round not found';
  end if;

  if not public.can_review_project(v_project_id) then
    raise exception 'not authorized';
  end if;

  if exists (
    select 1 from public.draft_round_projects
    where id = p_round_project_id and submitted_at is not null
  ) then
    raise exception 'this round has already been submitted';
  end if;

  if not exists (
    select 1
    from public.draft_round_projects rp
    join public.draft_rounds dr on dr.id = rp.round_id
    join public.draft_state ds on ds.period_id = dr.period_id
    where rp.id = p_round_project_id
      and ds.current_pick_id = p_round_project_id
  ) then
    raise exception 'it is not this project''s turn to pick';
  end if;

  for v_application_id in
    select application_id from public.draft_picks where round_project_id = p_round_project_id
  loop
    perform public.accept_application(v_application_id, v_project_id);
  end loop;

  update public.draft_round_projects
  set submitted_at = now()
  where id = p_round_project_id;
end;
$$;

grant execute on function public.submit_draft_picks(uuid) to authenticated;
