-- Project portals have no owner: they are governed entirely by their project
-- roster (managed PM admins). Only general/exec portals grant their creator a
-- locked owner-admin row.
--
-- 0014's portals_grant_creator_admin fired for EVERY portal type, so creating a
-- project (which auto-creates its portal via 0031) made the creator a locked
-- `is_owner` admin of that project portal — even when they aren't part of the
-- project. This reverts project portals to "0 owners, just locked PM admins":
-- the creator only appears if they're an actual project member (as a managed
-- row synced from project_members), never as an owner.

-- 1. Skip project portals when granting creator ownership. --------------------
create or replace function public.portals_grant_creator_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Project portals are governed entirely by their project roster (managed PM
  -- admins) and have no owner. Only general/exec portals grant the creator a
  -- locked owner-admin row.
  if auth.uid() is not null and new.type <> 'project' then
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

-- 2. Backfill: strip ownership from existing project portals. -----------------
-- Owner row that is also project-derived: keep it, but drop ownership so it
-- reverts to a plain synced PM/managed admin.
update public.portal_members pm
set is_owner = false
from public.portals po
where pm.portal_id = po.id
  and po.type = 'project'
  and pm.is_owner
  and pm.managed;

-- Owner-only row (creator was never a project member): remove it — they should
-- not linger on a project portal they aren't part of.
delete from public.portal_members pm
using public.portals po
where pm.portal_id = po.id
  and po.type = 'project'
  and pm.is_owner
  and not pm.managed;
