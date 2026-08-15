-- Project types (OP Studio / OP Launch) + the member application system.
--
--   1. projects gains a `type` (studio/launch) plus the info applicants need to
--      choose (difficulty 1-5, estimated members, subteams). OP Studio is client
--      work, so a Studio project must have a client; OP Launch is client-optional
--      (a passion project can have none).
--   2. PMs are treated as board: is_board_or_exec() now also returns true for any
--      PM, keeping RLS consistent with the app-layer access model.
--   3. applications + application_rankings: an applicant ranks their top 7
--      projects with a 150-200 word essay each. One application per applicant.
--
-- All writes go through the browser Supabase client, so the RLS policies below
-- are the sole write-authorization layer.

-- 1. Project types & fields --------------------------------------------------

alter table public.projects
  add column if not exists type text not null default 'launch';

alter table public.projects
  add column if not exists difficulty smallint;

alter table public.projects
  add column if not exists estimated_members int;

alter table public.projects
  add column if not exists num_subteams int;

alter table public.projects drop constraint if exists projects_type_check;
alter table public.projects
  add constraint projects_type_check check (type in ('studio', 'launch'));

alter table public.projects drop constraint if exists projects_difficulty_check;
alter table public.projects
  add constraint projects_difficulty_check
  check (difficulty is null or difficulty between 1 and 5);

-- OP Studio is client work: a Studio project must name a client. Launch is
-- client-optional. Safe to add: all existing rows default to 'launch'.
alter table public.projects drop constraint if exists projects_studio_requires_client_check;
alter table public.projects
  add constraint projects_studio_requires_client_check
  check (type <> 'studio' or client is not null);

-- 2. PMs count as board ------------------------------------------------------
-- board = exec + PMs. is_pm() (from 0012) is a PM of ANY project. Redefining
-- is_board_or_exec() here keeps DB RLS aligned with the client/server access
-- helpers that now fold PM status into board.
create or replace function public.is_board_or_exec()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_pm()
    or exists (
      select 1
      from public.members_roles mr
      join public.roles r on r.id = mr.role_id
      where mr.user_id = auth.uid()
        and r.access_level in ('board', 'exec')
    );
$$;

grant execute on function public.is_board_or_exec() to authenticated;

-- 3. Applications ------------------------------------------------------------

-- One application per applicant (the checklist checks existence by applicant_id).
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null unique
    references public.members(user_id) on delete cascade,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- A ranked project choice (1-7) with its 150-200 word essay. Word-count is
-- enforced in the app; the DB just stores the text.
create table if not exists public.application_rankings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.applications(id) on delete cascade,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  rank smallint not null check (rank between 1 and 7),
  essay text not null,
  created_at timestamptz not null default now(),
  unique (application_id, rank),
  unique (application_id, project_id)
);

create index if not exists application_rankings_application_id_idx
  on public.application_rankings(application_id);
create index if not exists application_rankings_project_id_idx
  on public.application_rankings(project_id);

alter table public.applications enable row level security;
alter table public.application_rankings enable row level security;

-- applications: an applicant manages their own row; board/exec can read all
-- (sets up a future review page without granting writes).
drop policy if exists "applications_select" on public.applications;
create policy "applications_select"
on public.applications
for select
to authenticated
using ( applicant_id = auth.uid() or public.is_board_or_exec() );

drop policy if exists "applications_insert" on public.applications;
create policy "applications_insert"
on public.applications
for insert
to authenticated
with check ( applicant_id = auth.uid() );

drop policy if exists "applications_update" on public.applications;
create policy "applications_update"
on public.applications
for update
to authenticated
using ( applicant_id = auth.uid() )
with check ( applicant_id = auth.uid() );

-- application_rankings: ownership derives from the parent application.
drop policy if exists "application_rankings_select" on public.application_rankings;
create policy "application_rankings_select"
on public.application_rankings
for select
to authenticated
using (
  public.is_board_or_exec()
  or exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_rankings_insert" on public.application_rankings;
create policy "application_rankings_insert"
on public.application_rankings
for insert
to authenticated
with check (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
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
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_rankings_delete" on public.application_rankings;
create policy "application_rankings_delete"
on public.application_rankings
for delete
to authenticated
using (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);
