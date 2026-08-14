-- Portal types: general (default), project (linked to a project), exec.
--
-- Adds a `type` and optional `project_id` to portals, and reworks who can
-- create/edit them plus how membership is resolved:
--
--   general  — a normal hub. Roster is the explicit portal_members/portal_roles
--              rows (unchanged from before). Created by exec or any PM.
--   project  — linked to a project. Membership is DERIVED from the project:
--              every project member is a portal member, every project PM is a
--              portal admin. Those derived perms are locked (no rows to edit),
--              so removing someone from the project removes them here, and
--              losing PM removes portal-admin. Explicit portal_members/
--              portal_roles still layer on additively. Created by exec, or by a
--              PM for a project they PM.
--   exec     — exec-only hub. Behaves like general at the membership level
--              (manual roster); exec already qualifies for every portal via
--              is_exec(). Only exec can create it.
--
-- Portal writes go directly through the browser Supabase client, so these RLS
-- policies are the sole write-authorization layer.

-- 1a. Columns + constraints on portals ---------------------------------------

alter table public.portals
  add column if not exists type text not null default 'general';

-- project_id is set only for type='project'. ON DELETE CASCADE (not SET NULL):
-- deleting a project deletes its project portal — SET NULL would leave a
-- type='project' row with a null project_id, violating the iff-CHECK below.
alter table public.portals
  add column if not exists project_id uuid
    references public.projects(id) on delete cascade;

alter table public.portals drop constraint if exists portals_type_check;
alter table public.portals
  add constraint portals_type_check
  check (type in ('general', 'project', 'exec'));

-- project_id is non-null IFF type = 'project'.
alter table public.portals drop constraint if exists portals_project_id_type_check;
alter table public.portals
  add constraint portals_project_id_type_check
  check (
    (type =  'project' and project_id is not null)
    or
    (type <> 'project' and project_id is null)
  );

create index if not exists portals_project_id_idx on public.portals(project_id);

-- At most one project portal per project.
create unique index if not exists portals_one_per_project_idx
  on public.portals(project_id) where project_id is not null;

-- Perf: derived-membership lookups filter project_members by user_id.
create index if not exists project_members_user_id_idx on public.project_members(user_id);

-- 1b. is_pm(): is the current user a PM of ANY project? ----------------------
-- (Used by the portals INSERT policy. Distinct from the project_members.is_pm
-- column and from the client-side "pm" persona.)
create or replace function public.is_pm()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.user_id = auth.uid()
      and pm.is_pm
  );
$$;

grant execute on function public.is_pm() to authenticated;

-- 1c. Rework is_portal_admin / is_portal_member to derive project membership --
--
-- Recursion note: these now read public.portals, and portals_select calls
-- is_portal_member(id). This is safe: the functions are SECURITY DEFINER owned
-- by the table owner, which bypasses RLS on the inner read (valid while portals
-- is not FORCE ROW LEVEL SECURITY — it isn't). project_members never references
-- portals.

-- Admin of a portal: exec, an explicit admin-tier row, an admin-tier mapped
-- role, OR — for project portals — a PM of the linked project.
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
    )
    -- DERIVED: project PMs are locked-in admins of the project's portal.
    or exists (
      select 1
      from public.portals po
      join public.project_members prm on prm.project_id = po.project_id
      where po.id = p_portal_id
        and po.type = 'project'
        and prm.user_id = auth.uid()
        and prm.is_pm
    );
$$;

grant execute on function public.is_portal_admin(uuid) to authenticated;

-- Member of a portal: any admin (incl. exec / project PMs), an explicit member
-- row, a mapped role of any tier, OR — for project portals — any member of the
-- linked project.
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
    )
    -- DERIVED: project members are auto members of the project's portal.
    or exists (
      select 1
      from public.portals po
      join public.project_members prm on prm.project_id = po.project_id
      where po.id = p_portal_id
        and po.type = 'project'
        and prm.user_id = auth.uid()
    );
$$;

grant execute on function public.is_portal_member(uuid) to authenticated;

-- 1d. Rework portals INSERT / UPDATE / DELETE policies -----------------------

-- INSERT: exec creates any type. A PM creates general/project (never exec); for
-- a project portal the PM must be a PM of that project. (portals.project_id is
-- qualified so it doesn't bind to project_members.project_id in the subquery.)
drop policy if exists "portals_insert_exec" on public.portals;
drop policy if exists "portals_insert" on public.portals;
create policy "portals_insert"
on public.portals
for insert
to authenticated
with check (
  public.is_exec()
  or (
    public.is_pm()
    and type in ('general', 'project')
    and (
      type <> 'project'
      or exists (
        select 1 from public.project_members pm
        where pm.project_id = portals.project_id
          and pm.user_id = auth.uid()
          and pm.is_pm
      )
    )
  )
);

-- UPDATE: portal admins (incl. project-portal PMs) edit metadata; the with
-- check blocks a non-exec from escalating a portal to type='exec' or
-- repointing it to a project they don't PM. Supersedes 0007's
-- portals_update_admin.
drop policy if exists "portals_update_exec" on public.portals;
drop policy if exists "portals_update_admin" on public.portals;
drop policy if exists "portals_update" on public.portals;
create policy "portals_update"
on public.portals
for update
to authenticated
using ( public.is_portal_admin(id) )
with check (
  public.is_exec()
  or (
    public.is_portal_admin(id)
    and type in ('general', 'project')
    and (
      type <> 'project'
      or exists (
        select 1 from public.project_members pm
        where pm.project_id = portals.project_id
          and pm.user_id = auth.uid()
          and pm.is_pm
      )
    )
  )
);

-- DELETE: exec only (deletion is destructive/low-frequency; deleting the
-- linked project also cascades a project portal away).
drop policy if exists "portals_delete_exec" on public.portals;
drop policy if exists "portals_delete" on public.portals;
create policy "portals_delete"
on public.portals
for delete
to authenticated
using ( public.is_exec() );

-- 1e. Creator-admin trigger --------------------------------------------------
-- A PM who creates a general/exec portal isn't otherwise a member of it (no
-- explicit row, not exec, not a project), so portals_select would hide it and
-- RLS blocks self-granting. Grant the non-exec creator an explicit admin row.
-- Project portals need nothing (membership is derived); exec creators already
-- qualify via is_exec().
create or replace function public.portals_grant_creator_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type <> 'project' and auth.uid() is not null and not public.is_exec() then
    insert into public.portal_members (portal_id, user_id, is_admin)
    values (new.id, auth.uid(), true)
    on conflict (portal_id, user_id) do update set is_admin = true;
  end if;
  return new;
end;
$$;

drop trigger if exists portals_grant_creator_admin on public.portals;
create trigger portals_grant_creator_admin
after insert on public.portals
for each row execute function public.portals_grant_creator_admin();
