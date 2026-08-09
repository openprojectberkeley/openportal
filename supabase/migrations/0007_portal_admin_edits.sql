-- Let portal admins (not just exec) edit their portal's metadata and role mappings.
--
-- 0006 made portal metadata (name/icon/color/description) and role mappings
-- exec-only. Portal admins (an is_admin member row, an admin-tier mapped role,
-- or exec) now manage their own portal. Portals are still CREATED/DELETED by
-- exec only. `is_portal_admin` is defined in 0006.
--
-- Trade-off: a portal admin can grant admin-tier to a member or a role, which
-- expands who administers that portal. Intended.

drop policy if exists "portals_update_exec" on public.portals;
drop policy if exists "portals_update_admin" on public.portals;
create policy "portals_update_admin"
on public.portals
for update
to authenticated
using ( public.is_portal_admin(id) )
with check ( public.is_portal_admin(id) );

drop policy if exists "portal_roles_write" on public.portal_roles;
create policy "portal_roles_write"
on public.portal_roles
for all
to authenticated
using ( public.is_portal_admin(portal_id) )
with check ( public.is_portal_admin(portal_id) );
