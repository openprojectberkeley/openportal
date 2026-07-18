-- Projects for the current semester, plus their member roster.
--
-- `projects` holds the project-level info (name, client, description).
-- `project_members` links members to projects, with `is_pm` marking which
-- members are PMs on that project (a project can have more than one PM).
-- Managed from the admin page, exec-only.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  client      text,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.project_members (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.members(user_id) on delete cascade,
  is_pm      boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- Helper: does the current user have exec-level access?
create or replace function public.is_exec()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.members_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.user_id = auth.uid()
      and r.access_level = 'exec'
  );
$$;

grant execute on function public.is_exec() to authenticated;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

-- Everyone signed in can read projects and their rosters (members should be
-- able to see what project they're on).
drop policy if exists "projects_select" on public.projects;
create policy "projects_select"
on public.projects
for select
to authenticated
using ( true );

drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select"
on public.project_members
for select
to authenticated
using ( true );

-- Only exec can create/update/delete projects and manage rosters.
drop policy if exists "projects_insert_exec" on public.projects;
create policy "projects_insert_exec"
on public.projects
for insert
to authenticated
with check ( public.is_exec() );

drop policy if exists "projects_update_exec" on public.projects;
create policy "projects_update_exec"
on public.projects
for update
to authenticated
using ( public.is_exec() )
with check ( public.is_exec() );

drop policy if exists "projects_delete_exec" on public.projects;
create policy "projects_delete_exec"
on public.projects
for delete
to authenticated
using ( public.is_exec() );

drop policy if exists "project_members_insert_exec" on public.project_members;
create policy "project_members_insert_exec"
on public.project_members
for insert
to authenticated
with check ( public.is_exec() );

drop policy if exists "project_members_update_exec" on public.project_members;
create policy "project_members_update_exec"
on public.project_members
for update
to authenticated
using ( public.is_exec() )
with check ( public.is_exec() );

drop policy if exists "project_members_delete_exec" on public.project_members;
create policy "project_members_delete_exec"
on public.project_members
for delete
to authenticated
using ( public.is_exec() );
