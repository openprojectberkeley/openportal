-- PMs' attendance reads were timing out (statement timeout → 500), and the
-- sheet rendered every cell blank.
--
-- The 0111 SELECT policy called can_mark_event_attendance(event_id, user_id)
-- per row, which calls is_portal_admin() (four subqueries). Those are
-- SET search_path SQL functions, so Postgres re-plans them on every call:
-- ~4s for a PM's portal sheet (~900 rows read, incl. other projects' rows on
-- imported club events). Exec were fine only because is_exec() short-circuits.
--
-- Same visibility, computed once per query instead of per row:
--   * the viewer's own rows
--   * exec: everything
--   * events owned by a portal the viewer admins
--   * club events imported into a portal the viewer admins, for that portal's
--     members only (the (event, member) pairs, as 'event_id:user_id')
-- Writes keep can_mark_event_attendance(): they touch one row at a time.

create or replace function public.attendance_admin_event_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id), '{}')
  from public.portal_events e
  where e.portal_id in (select p.id from public.portals p where public.is_portal_admin(p.id));
$$;

create or replace function public.attendance_admin_pairs()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(i.event_id::text || ':' || pm.user_id::text), '{}')
  from public.portal_imported_events i
  join public.portal_events e on e.id = i.event_id and e.portal_id is null
  join public.portal_members pm on pm.portal_id = i.portal_id
  where i.portal_id in (select p.id from public.portals p where public.is_portal_admin(p.id));
$$;

revoke execute on function public.attendance_admin_event_ids() from public, anon;
revoke execute on function public.attendance_admin_pairs() from public, anon;
grant execute on function public.attendance_admin_event_ids() to authenticated;
grant execute on function public.attendance_admin_pairs() to authenticated;

-- (select …)::type[] makes each an InitPlan: evaluated once per query.
drop policy if exists "portal_event_attendance_select" on public.portal_event_attendance;
create policy "portal_event_attendance_select"
on public.portal_event_attendance
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_exec())
  or event_id = any ((select public.attendance_admin_event_ids())::uuid[])
  or (event_id::text || ':' || user_id::text) = any ((select public.attendance_admin_pairs())::text[])
);
