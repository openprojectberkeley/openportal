-- Materialize project-portal membership as real portal_members rows.
--
-- 0012 derived project-portal membership at query time (in is_portal_member /
-- is_portal_admin) instead of storing rows. That granted access but left the
-- roster invisible everywhere that reads portal_members directly (members
-- modal, card roster, attendance). This migration instead MATERIALIZES the
-- roster: creating a project portal copies the project's members into
-- portal_members (PMs as admins), and triggers keep them in sync as the project
-- roster changes. These rows are `managed` — locked from manual edits (only the
-- sync triggers touch them), so removing someone from the project removes them
-- from the portal, and PM status maps to portal-admin automatically.

-- 1. Mark project-derived rows so they can be kept in sync and locked. --------
alter table public.portal_members
  add column if not exists managed boolean not null default false;

-- 2. Populate a project portal's roster when it is created. -------------------
create or replace function public.populate_project_portal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'project' and new.project_id is not null then
    insert into public.portal_members (portal_id, user_id, is_admin, managed)
    select new.id, prm.user_id, prm.is_pm, true
    from public.project_members prm
    where prm.project_id = new.project_id
    on conflict (portal_id, user_id)
    do update set is_admin = excluded.is_admin, managed = true;
  end if;
  return new;
end;
$$;

drop trigger if exists populate_project_portal on public.portals;
create trigger populate_project_portal
after insert on public.portals
for each row execute function public.populate_project_portal();

-- 3. Keep project portals in sync as the project roster changes. --------------
-- Add/remove a project member → add/remove the managed portal row; toggling a
-- member's PM flag → flip their managed portal row's admin tier.
create or replace function public.sync_project_members_to_portals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.portal_members pm
    using public.portals po
    where pm.portal_id = po.id
      and po.type = 'project'
      and po.project_id = old.project_id
      and pm.user_id = old.user_id
      and pm.managed;
    return old;
  end if;

  -- On UPDATE that moves the row to a different project/user, drop the stale
  -- managed row before re-inserting the new one.
  if tg_op = 'UPDATE'
     and (old.project_id <> new.project_id or old.user_id <> new.user_id) then
    delete from public.portal_members pm
    using public.portals po
    where pm.portal_id = po.id
      and po.type = 'project'
      and po.project_id = old.project_id
      and pm.user_id = old.user_id
      and pm.managed;
  end if;

  insert into public.portal_members (portal_id, user_id, is_admin, managed)
  select po.id, new.user_id, new.is_pm, true
  from public.portals po
  where po.type = 'project'
    and po.project_id = new.project_id
  on conflict (portal_id, user_id)
  do update set is_admin = excluded.is_admin, managed = true;

  return new;
end;
$$;

drop trigger if exists sync_project_members_to_portals on public.project_members;
create trigger sync_project_members_to_portals
after insert or update or delete on public.project_members
for each row execute function public.sync_project_members_to_portals();

-- 4. Rows are now the single source of truth — drop the derived branches added
--    in 0012 from the membership helpers (back to explicit rows + exec). ------
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

-- 5. Lock managed rows: only the sync triggers (SECURITY DEFINER, RLS-exempt)
--    may write them. Portal admins can still add/edit their own extra rows. ---
drop policy if exists "portal_members_write" on public.portal_members;
create policy "portal_members_write"
on public.portal_members
for all
to authenticated
using ( public.is_portal_admin(portal_id) and not managed )
with check ( public.is_portal_admin(portal_id) and not managed );

-- 6. Backfill: populate every existing project portal from its project. -------
insert into public.portal_members (portal_id, user_id, is_admin, managed)
select po.id, prm.user_id, prm.is_pm, true
from public.portals po
join public.project_members prm on prm.project_id = po.project_id
where po.type = 'project'
on conflict (portal_id, user_id)
do update set is_admin = excluded.is_admin, managed = true;
