-- Portal ownership: whoever creates a portal becomes a locked admin of it.
--
-- Whether an exec or a PM creates the portal (any type), the creator gets a
-- portal_members row flagged `is_owner` with admin tier. Owner rows are locked
-- like `managed` rows — they can't be removed or demoted from the UI (RLS
-- blocks it), and the project-sync triggers never delete or demote them. This
-- guarantees the creator keeps admin "due to ownership" even if, say, a PM is
-- later removed from the underlying project.

-- 1. Ownership flag on the roster row. ---------------------------------------
alter table public.portal_members
  add column if not exists is_owner boolean not null default false;

-- 2. Grant the creator a locked owner-admin row — for every type and every
--    creator (exec included; supersedes 0012's non-exec-only version). --------
create or replace function public.portals_grant_creator_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.portal_members (portal_id, user_id, is_admin, is_owner)
    values (new.id, auth.uid(), true, true)
    on conflict (portal_id, user_id)
    do update set is_admin = true, is_owner = true;
  end if;
  return new;
end;
$$;

drop trigger if exists portals_grant_creator_admin on public.portals;
create trigger portals_grant_creator_admin
after insert on public.portals
for each row execute function public.portals_grant_creator_admin();

-- 3. Make project-roster sync respect ownership: never delete or demote an
--    owner row (from 0013). ---------------------------------------------------
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
      and pm.managed
      and not pm.is_owner;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (old.project_id <> new.project_id or old.user_id <> new.user_id) then
    delete from public.portal_members pm
    using public.portals po
    where pm.portal_id = po.id
      and po.type = 'project'
      and po.project_id = old.project_id
      and pm.user_id = old.user_id
      and pm.managed
      and not pm.is_owner;
  end if;

  insert into public.portal_members (portal_id, user_id, is_admin, managed)
  select po.id, new.user_id, new.is_pm, true
  from public.portals po
  where po.type = 'project'
    and po.project_id = new.project_id
  on conflict (portal_id, user_id)
  do update set
    -- owners always keep admin; otherwise track the project's PM flag.
    is_admin = case when portal_members.is_owner then true else excluded.is_admin end,
    managed = true;

  return new;
end;
$$;

-- 4. Lock owner rows too (in addition to managed rows). ----------------------
drop policy if exists "portal_members_write" on public.portal_members;
create policy "portal_members_write"
on public.portal_members
for all
to authenticated
using ( public.is_portal_admin(portal_id) and not managed and not is_owner )
with check ( public.is_portal_admin(portal_id) and not managed and not is_owner );
