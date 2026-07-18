-- Generalized "portals" — every portal type (project, committee, chapter, ...)
-- is a row in `portals`. `portal_members` / `portal_tasks` / `portal_documents` /
-- `portal_updates` hang off `portal_id` and are shared by every portal type.
--
-- Existing `projects` / `project_members` data is backfilled below as
-- type = 'project' portals (reusing the original ids, so the backfill is safe
-- to re-run). The old tables are left in place, unused, until a follow-up
-- migration drops them once the cutover is verified.

create table if not exists public.portals (
  id          uuid primary key default gen_random_uuid(),
  type        text not null default 'project',
  name        text not null,
  description text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.portal_members (
  id         uuid primary key default gen_random_uuid(),
  portal_id  uuid not null references public.portals(id) on delete cascade,
  user_id    uuid not null references public.members(user_id) on delete cascade,
  role       text not null default 'member' check (role in ('member', 'lead')),
  created_at timestamptz not null default now(),
  unique (portal_id, user_id)
);

create table if not exists public.portal_tasks (
  id          uuid primary key default gen_random_uuid(),
  portal_id   uuid not null references public.portals(id) on delete cascade,
  title       text not null,
  description text,
  status      text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  assignee_id uuid references public.members(user_id) on delete set null,
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.portal_documents (
  id         uuid primary key default gen_random_uuid(),
  portal_id  uuid not null references public.portals(id) on delete cascade,
  title      text not null,
  url        text not null,
  created_by uuid references public.members(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.portal_updates (
  id         uuid primary key default gen_random_uuid(),
  portal_id  uuid not null references public.portals(id) on delete cascade,
  author_id  uuid references public.members(user_id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

-- Helper: is the current user a 'lead' on this specific portal?
create or replace function public.is_portal_lead(target_portal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.portal_members pm
    where pm.portal_id = target_portal_id
      and pm.user_id = auth.uid()
      and pm.role = 'lead'
  );
$$;

grant execute on function public.is_portal_lead(uuid) to authenticated;

alter table public.portals enable row level security;
alter table public.portal_members enable row level security;
alter table public.portal_tasks enable row level security;
alter table public.portal_documents enable row level security;
alter table public.portal_updates enable row level security;

-- Everyone signed in can read every portal and its content (same openness as
-- `projects` has today — members should be able to see what portal they're on,
-- and browse others).
drop policy if exists "portals_select" on public.portals;
create policy "portals_select"
on public.portals
for select
to authenticated
using ( true );

drop policy if exists "portal_members_select" on public.portal_members;
create policy "portal_members_select"
on public.portal_members
for select
to authenticated
using ( true );

drop policy if exists "portal_tasks_select" on public.portal_tasks;
create policy "portal_tasks_select"
on public.portal_tasks
for select
to authenticated
using ( true );

drop policy if exists "portal_documents_select" on public.portal_documents;
create policy "portal_documents_select"
on public.portal_documents
for select
to authenticated
using ( true );

drop policy if exists "portal_updates_select" on public.portal_updates;
create policy "portal_updates_select"
on public.portal_updates
for select
to authenticated
using ( true );

-- Only exec can create/update/delete portals and manage rosters (mirrors
-- projects_insert_exec / project_members_insert_exec from 0005).
drop policy if exists "portals_insert_exec" on public.portals;
create policy "portals_insert_exec"
on public.portals
for insert
to authenticated
with check ( public.is_exec() );

drop policy if exists "portals_update_exec" on public.portals;
create policy "portals_update_exec"
on public.portals
for update
to authenticated
using ( public.is_exec() )
with check ( public.is_exec() );

drop policy if exists "portals_delete_exec" on public.portals;
create policy "portals_delete_exec"
on public.portals
for delete
to authenticated
using ( public.is_exec() );

drop policy if exists "portal_members_insert_exec" on public.portal_members;
create policy "portal_members_insert_exec"
on public.portal_members
for insert
to authenticated
with check ( public.is_exec() );

drop policy if exists "portal_members_update_exec" on public.portal_members;
create policy "portal_members_update_exec"
on public.portal_members
for update
to authenticated
using ( public.is_exec() )
with check ( public.is_exec() );

drop policy if exists "portal_members_delete_exec" on public.portal_members;
create policy "portal_members_delete_exec"
on public.portal_members
for delete
to authenticated
using ( public.is_exec() );

-- Portal content (tasks/documents/updates): exec, or a 'lead' on that specific
-- portal, can write. This is new — today only is_exec() can write project data
-- at all; PMs/leads get no write access of their own.
drop policy if exists "portal_tasks_insert" on public.portal_tasks;
create policy "portal_tasks_insert"
on public.portal_tasks
for insert
to authenticated
with check ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_tasks_update" on public.portal_tasks;
create policy "portal_tasks_update"
on public.portal_tasks
for update
to authenticated
using ( public.is_exec() or public.is_portal_lead(portal_id) )
with check ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_tasks_delete" on public.portal_tasks;
create policy "portal_tasks_delete"
on public.portal_tasks
for delete
to authenticated
using ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_documents_insert" on public.portal_documents;
create policy "portal_documents_insert"
on public.portal_documents
for insert
to authenticated
with check ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_documents_update" on public.portal_documents;
create policy "portal_documents_update"
on public.portal_documents
for update
to authenticated
using ( public.is_exec() or public.is_portal_lead(portal_id) )
with check ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_documents_delete" on public.portal_documents;
create policy "portal_documents_delete"
on public.portal_documents
for delete
to authenticated
using ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_updates_insert" on public.portal_updates;
create policy "portal_updates_insert"
on public.portal_updates
for insert
to authenticated
with check ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_updates_update" on public.portal_updates;
create policy "portal_updates_update"
on public.portal_updates
for update
to authenticated
using ( public.is_exec() or public.is_portal_lead(portal_id) )
with check ( public.is_exec() or public.is_portal_lead(portal_id) );

drop policy if exists "portal_updates_delete" on public.portal_updates;
create policy "portal_updates_delete"
on public.portal_updates
for delete
to authenticated
using ( public.is_exec() or public.is_portal_lead(portal_id) );

-- Backfill existing projects as type='project' portals, reusing the original
-- project id as the portal id so this insert is safe to re-run.
insert into public.portals (id, type, name, description, metadata, created_at, updated_at)
select
  p.id,
  'project',
  p.name,
  p.description,
  jsonb_strip_nulls(jsonb_build_object('client', p.client)),
  p.created_at,
  p.updated_at
from public.projects p
on conflict (id) do nothing;

insert into public.portal_members (portal_id, user_id, role, created_at)
select
  pm.project_id,
  pm.user_id,
  case when pm.is_pm then 'lead' else 'member' end,
  pm.created_at
from public.project_members pm
on conflict (portal_id, user_id) do nothing;
