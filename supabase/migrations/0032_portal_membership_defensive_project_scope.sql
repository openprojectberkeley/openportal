-- Defense-in-depth for project-portal visibility.
--
-- Project-portal access is enforced by portals_select -> is_portal_member(id).
-- Since 0013 that resolves purely from materialized `portal_members` rows kept
-- in sync by triggers, which already scopes each PM/member to their own
-- project's portal. This migration additionally derives access DIRECTLY from
-- project membership, so that even if the materialized roster ever drifts out of
-- sync (a missed trigger, a manual data fix), a project's members/PMs still see
-- exactly — and only — their own project's portal.
--
-- This is a UNION of the explicit-row checks (0013) and the derived checks
-- (originally 0012). It cannot widen visibility across projects: the derived
-- branch joins project_members on THIS portal's project and filters to
-- auth.uid(), so a PM still only reaches portals for projects they are on.
--
-- Recursion note (unchanged from 0012): these functions read public.portals and
-- portals_select calls is_portal_member(id). Safe because they are SECURITY
-- DEFINER owned by the table owner (bypasses RLS on the inner read while portals
-- is not FORCE ROW LEVEL SECURITY — it isn't); project_members never references
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
