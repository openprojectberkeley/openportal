-- Portals: hub spaces members belong to, plus their rosters, auto-admin roles,
-- and calendar events.
--
-- Modeled after projects (0005). Portals are created/removed by exec from the
-- admin page, but each portal also carries its own admin-tier members (who can
-- manage the roster and create events) alongside general-access members.
--
-- `portal_members` links members to a portal, `is_admin` marks the admin tier.
-- `portal_roles`   maps roles to a portal: every holder is auto-assigned as a
--                  member, `is_admin` sets the tier that mapping grants.
-- `portal_events`  calendar events scoped to a portal; visible to every member.

create table if not exists public.portals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  icon        text,          -- optional emoji for the card
  color       text,          -- optional accent color (hex) for the card
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.portal_members (
  id         uuid primary key default gen_random_uuid(),
  portal_id  uuid not null references public.portals(id) on delete cascade,
  user_id    uuid not null references public.members(user_id) on delete cascade,
  is_admin   boolean not null default false,   -- admin tier vs general tier
  created_at timestamptz not null default now(),
  unique (portal_id, user_id)
);

-- Roles mapped to a portal: everyone holding the role is automatically a member,
-- with no explicit member row needed. `is_admin` chooses the tier that mapping
-- grants — admin access (manage roster, create events) or general access.
-- (Supersedes the earlier portal_admin_roles table, which only granted admin.
-- Dropping it is safe: this feature is new and the table holds no data.)
drop table if exists public.portal_admin_roles cascade;

create table if not exists public.portal_roles (
  id         uuid primary key default gen_random_uuid(),
  portal_id  uuid not null references public.portals(id) on delete cascade,
  -- roles.id is a smallint (not a uuid), so role_id must match it.
  role_id    smallint not null references public.roles(id) on delete cascade,
  is_admin   boolean not null default false,   -- tier granted to holders of this role
  created_at timestamptz not null default now(),
  unique (portal_id, role_id)
);

create table if not exists public.portal_events (
  id          uuid primary key default gen_random_uuid(),
  portal_id   uuid not null references public.portals(id) on delete cascade,
  title       text not null,
  description text,
  start_time  timestamptz not null,
  end_time    timestamptz,
  all_day     boolean not null default false,
  created_by  uuid references public.members(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists portal_events_portal_id_idx on public.portal_events(portal_id);
create index if not exists portal_events_start_time_idx on public.portal_events(start_time);

-- is_exec() already exists from 0005_projects.sql; reused below.

-- Admin of a portal: exec, an explicit admin-tier row, or an auto-admin role.
create or replace function public.is_portal_admin(p_portal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_exec()
    or exists (
      select 1 from public.portal_members pm
      where pm.portal_id = p_portal_id
        and pm.user_id = auth.uid()
        and pm.is_admin
    )
    or exists (
      select 1
      from public.portal_roles pr
      join public.members_roles mr on mr.role_id = pr.role_id
      where pr.portal_id = p_portal_id
        and mr.user_id = auth.uid()
        and pr.is_admin
    );
$$;

grant execute on function public.is_portal_admin(uuid) to authenticated;

-- Member of a portal: an admin (incl. via admin role/exec), an explicit member
-- row, or a mapped role of any tier (general roles grant membership too).
create or replace function public.is_portal_member(p_portal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_portal_admin(p_portal_id)
    or exists (
      select 1 from public.portal_members pm
      where pm.portal_id = p_portal_id
        and pm.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.portal_roles pr
      join public.members_roles mr on mr.role_id = pr.role_id
      where pr.portal_id = p_portal_id
        and mr.user_id = auth.uid()
    );
$$;

grant execute on function public.is_portal_member(uuid) to authenticated;

alter table public.portals        enable row level security;
alter table public.portal_members enable row level security;
alter table public.portal_roles   enable row level security;
alter table public.portal_events  enable row level security;

-- portals: read the portals you belong to; only exec creates/edits/removes them.
drop policy if exists "portals_select" on public.portals;
create policy "portals_select"
on public.portals
for select
to authenticated
using ( public.is_portal_member(id) );

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

-- portal_members: members see the roster of their portals; portal admins
-- (which includes exec) manage it.
drop policy if exists "portal_members_select" on public.portal_members;
create policy "portal_members_select"
on public.portal_members
for select
to authenticated
using ( public.is_portal_member(portal_id) );

drop policy if exists "portal_members_write" on public.portal_members;
create policy "portal_members_write"
on public.portal_members
for all
to authenticated
using ( public.is_portal_admin(portal_id) )
with check ( public.is_portal_admin(portal_id) );

-- portal_roles: members can read; only exec configures which roles map to a portal.
drop policy if exists "portal_roles_select" on public.portal_roles;
create policy "portal_roles_select"
on public.portal_roles
for select
to authenticated
using ( public.is_portal_member(portal_id) );

drop policy if exists "portal_roles_write" on public.portal_roles;
create policy "portal_roles_write"
on public.portal_roles
for all
to authenticated
using ( public.is_exec() )
with check ( public.is_exec() );

-- portal_events: members read events of their portals; portal admins write them.
drop policy if exists "portal_events_select" on public.portal_events;
create policy "portal_events_select"
on public.portal_events
for select
to authenticated
using ( public.is_portal_member(portal_id) );

drop policy if exists "portal_events_insert" on public.portal_events;
create policy "portal_events_insert"
on public.portal_events
for insert
to authenticated
with check ( public.is_portal_admin(portal_id) and created_by = auth.uid() );

drop policy if exists "portal_events_update" on public.portal_events;
create policy "portal_events_update"
on public.portal_events
for update
to authenticated
using ( public.is_portal_admin(portal_id) )
with check ( public.is_portal_admin(portal_id) );

drop policy if exists "portal_events_delete" on public.portal_events;
create policy "portal_events_delete"
on public.portal_events
for delete
to authenticated
using ( public.is_portal_admin(portal_id) );
