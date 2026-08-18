-- Application periods + the accept/reject lifecycle.
--
--   1. application_periods: named recruitment cycles (e.g. "Fall 2026") with a
--      window and an explicit status (draft/open/closed). Non-members can only
--      apply while a period is `open` and now() is within its window. Exec
--      manages them; everyone signed in can read (applicants need to know if a
--      period is open). Helpers applications_open() / current_application_period()
--      back the client + RLS gating.
--   2. applications gains period_id (which cycle it belongs to), the review
--      outcome fields (accepted_project_id, reviewed_at/by), and its status
--      CHECK widens to draft/submitted/accepted/rejected. One application per
--      applicant *per period* now (was one per applicant ever).
--   3. accept_application / reject_application: SECURITY DEFINER RPCs so a
--      reviewer (board/exec) can, in one privileged step, mark the outcome and —
--      on accept — place the applicant on a project (project_members insert,
--      which the 0013 triggers sync into that project's portal) and activate
--      their membership (members.active = true). Doing this in a definer function
--      avoids loosening the exec-only project_members / members write RLS.
--   4. Applicant write policies (applications, application_rankings,
--      application_answers) now also require applications_open(), so drafts can
--      only be created/edited while a period is open. The RPCs bypass this (they
--      run as definer), so acceptance still works after a period closes.
--
-- All applicant writes go through the browser Supabase client, so the RLS
-- policies here are the sole write-authorization layer.

-- 1. application_periods ------------------------------------------------------

create table if not exists public.application_periods (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.application_periods drop constraint if exists application_periods_status_check;
alter table public.application_periods
  add constraint application_periods_status_check check (status in ('draft', 'open', 'closed'));

create index if not exists application_periods_status_idx
  on public.application_periods(status);

-- Is some period currently accepting applications? `open` status AND now within
-- its window. Used by the applicant page and by the write-gating policies below.
-- Is some period currently accepting applications? `open` status AND now within
-- its window. Used by the applicant page and by the write-gating policies below.
-- (Superseded by 0023, which makes `status = 'open'` the sole switch.)
create or replace function public.applications_open()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.application_periods p
    where p.status = 'open'
      and now() >= p.starts_at
      and now() < p.ends_at
  );
$$;

grant execute on function public.applications_open() to authenticated;

-- The period an applicant's new draft belongs to: the currently-open one if any,
-- else the most recently created (so the review page has a sensible default).
-- (Superseded by 0023.)
create or replace function public.current_application_period()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.application_periods
  order by (status = 'open' and now() >= starts_at and now() < ends_at) desc,
           created_at desc
  limit 1;
$$;

grant execute on function public.current_application_period() to authenticated;

-- Is the current user a returning member? A returning member is an already-active
-- member (accepted in a prior round); a first-time applicant is inactive. Used to
-- gate OP Studio eligibility: first-timers may only apply to OP Launch projects.
create or replace function public.is_returning_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.active
  );
$$;

grant execute on function public.is_returning_member() to authenticated;

alter table public.application_periods enable row level security;

-- Everyone signed in can read periods (applicants check whether one is open).
drop policy if exists "application_periods_select" on public.application_periods;
create policy "application_periods_select"
on public.application_periods
for select
to authenticated
using ( true );

-- Only exec creates/edits/removes periods (mirrors portal/project admin).
drop policy if exists "application_periods_write" on public.application_periods;
create policy "application_periods_write"
on public.application_periods
for all
to authenticated
using ( public.is_exec() )
with check ( public.is_exec() );

-- 2. applications: period + review outcome -----------------------------------

alter table public.applications
  add column if not exists period_id uuid references public.application_periods(id) on delete set null;
alter table public.applications
  add column if not exists accepted_project_id uuid references public.projects(id) on delete set null;
alter table public.applications
  add column if not exists reviewed_at timestamptz;
alter table public.applications
  add column if not exists reviewed_by uuid references public.members(user_id) on delete set null;

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications
  add constraint applications_status_check
  check (status in ('draft', 'submitted', 'accepted', 'rejected'));

create index if not exists applications_period_id_idx on public.applications(period_id);

-- 3. Seed an initial open period + backfill existing applications ------------
-- Keeps existing behavior working (applications stay open) and gives legacy
-- rows a period before the one-per-period unique index is added below.

insert into public.application_periods (name, starts_at, ends_at, status)
select 'Current', now() - interval '30 days', now() + interval '365 days', 'open'
where not exists (select 1 from public.application_periods);

update public.applications
set period_id = (select id from public.application_periods order by created_at asc limit 1)
where period_id is null;

-- One application per applicant *per period* (was one per applicant ever). Drop
-- the old applicant-only unique (both the 0016 inline constraint and the 0020
-- index) before adding the composite one.
alter table public.applications drop constraint if exists applications_applicant_id_key;
drop index if exists public.applications_applicant_id_uidx;
create unique index if not exists applications_applicant_period_uidx
  on public.applications(applicant_id, period_id);

-- 4. accept / reject RPCs ----------------------------------------------------

-- Accept: record the outcome, place the applicant on the chosen project (the
-- 0013 triggers propagate that into the project's portal), and activate their
-- membership. Reviewer must be board/exec.
create or replace function public.accept_application(p_application_id uuid, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applicant uuid;
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  select applicant_id into v_applicant
  from public.applications
  where id = p_application_id;

  if v_applicant is null then
    raise exception 'application not found';
  end if;

  -- First-time (inactive) applicants aren't eligible for OP Studio projects.
  -- (The application_rankings RLS already stops them ranking one; this guards the
  -- reviewer's placement too.)
  if exists (select 1 from public.projects where id = p_project_id and type = 'studio')
     and not exists (select 1 from public.members where user_id = v_applicant and active) then
    raise exception 'first-time applicants are not eligible for OP Studio projects';
  end if;

  update public.applications
  set status = 'accepted',
      accepted_project_id = p_project_id,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_application_id;

  insert into public.project_members (project_id, user_id, is_pm)
  values (p_project_id, v_applicant, false)
  on conflict (project_id, user_id) do nothing;

  update public.members
  set active = true
  where user_id = v_applicant;
end;
$$;

grant execute on function public.accept_application(uuid, uuid) to authenticated;

-- Reject: record the outcome only. No membership/placement is created.
create or replace function public.reject_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  update public.applications
  set status = 'rejected',
      accepted_project_id = null,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_application_id;

  if not found then
    raise exception 'application not found';
  end if;
end;
$$;

grant execute on function public.reject_application(uuid) to authenticated;

-- 5. Gate applicant writes on an open period ---------------------------------
-- Applicants can only create/edit their application while a period is open. The
-- accept/reject RPCs run as SECURITY DEFINER and bypass these, so acceptance
-- still works once a period has closed.

drop policy if exists "applications_insert" on public.applications;
create policy "applications_insert"
on public.applications
for insert
to authenticated
with check ( applicant_id = auth.uid() and public.applications_open() );

drop policy if exists "applications_update" on public.applications;
create policy "applications_update"
on public.applications
for update
to authenticated
using ( applicant_id = auth.uid() and public.applications_open() )
with check ( applicant_id = auth.uid() and public.applications_open() );

drop policy if exists "application_rankings_insert" on public.application_rankings;
create policy "application_rankings_insert"
on public.application_rankings
for insert
to authenticated
with check (
  public.applications_open()
  and exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
  -- First-timers (inactive) may only rank OP Launch projects; returning members
  -- (active) may rank either type.
  and (
    public.is_returning_member()
    or exists (
      select 1 from public.projects p
      where p.id = application_rankings.project_id and p.type = 'launch'
    )
  )
);

drop policy if exists "application_rankings_update" on public.application_rankings;
create policy "application_rankings_update"
on public.application_rankings
for update
to authenticated
using (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
)
with check (
  public.applications_open()
  and exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
  and (
    public.is_returning_member()
    or exists (
      select 1 from public.projects p
      where p.id = application_rankings.project_id and p.type = 'launch'
    )
  )
);

drop policy if exists "application_rankings_delete" on public.application_rankings;
create policy "application_rankings_delete"
on public.application_rankings
for delete
to authenticated
using (
  public.applications_open()
  and exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_insert" on public.application_answers;
create policy "application_answers_insert"
on public.application_answers
for insert
to authenticated
with check (
  public.applications_open()
  and exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_update" on public.application_answers;
create policy "application_answers_update"
on public.application_answers
for update
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
)
with check (
  public.applications_open()
  and exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_delete" on public.application_answers;
create policy "application_answers_delete"
on public.application_answers
for delete
to authenticated
using (
  public.applications_open()
  and exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);
