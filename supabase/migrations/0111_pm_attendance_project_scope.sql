-- PMs take attendance for their own project only.
--
-- 0095 let board/exec mark anyone at any club event, and is_board_or_exec()
-- includes PMs (0016), so a PM could mark every member of every project. Now:
--
-- * Club events (portal_id null): exec mark anyone. Everyone else (PMs, other
--   portal admins) marks only through a portal that imported the event (0102),
--   and only that portal's members. Clicking "Take attendance" on a club event
--   as a PM imports it into their project's portal first (calendar-panel).
-- * Portal events: unchanged — the portal's admins.
--
-- The check is now per (event, member), so it can scope the member as well as
-- the event; the policies below use it in place of the event-only check.

create or replace function public.can_mark_event_attendance(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.portal_events e
    where e.id = p_event_id
      and case
            when e.portal_id is null then
              public.is_exec()
              or exists (
                select 1
                from public.portal_imported_events i
                join public.portal_members pm
                  on pm.portal_id = i.portal_id and pm.user_id = p_user_id
                where i.event_id = e.id
                  and public.is_portal_admin(i.portal_id)
              )
            else public.is_portal_admin(e.portal_id)
          end
  );
$$;

grant execute on function public.can_mark_event_attendance(uuid, uuid) to authenticated;

-- Event-level check (no member in hand): same split, PMs no longer club-wide.
create or replace function public.can_take_event_attendance(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.portal_events e
    where e.id = p_event_id
      and case
            when e.portal_id is null then
              public.is_exec()
              or exists (
                select 1 from public.portal_imported_events i
                where i.event_id = e.id
                  and public.is_portal_admin(i.portal_id)
              )
            else public.is_portal_admin(e.portal_id)
          end
  );
$$;

grant execute on function public.can_take_event_attendance(uuid) to authenticated;

drop policy if exists "portal_event_attendance_select" on public.portal_event_attendance;
create policy "portal_event_attendance_select"
on public.portal_event_attendance
for select
to authenticated
using ( user_id = auth.uid() or public.can_mark_event_attendance(event_id, user_id) );

drop policy if exists "portal_event_attendance_insert" on public.portal_event_attendance;
create policy "portal_event_attendance_insert"
on public.portal_event_attendance
for insert
to authenticated
with check ( public.can_mark_event_attendance(event_id, user_id) and recorded_by = auth.uid() );

drop policy if exists "portal_event_attendance_update" on public.portal_event_attendance;
create policy "portal_event_attendance_update"
on public.portal_event_attendance
for update
to authenticated
using ( public.can_mark_event_attendance(event_id, user_id) )
with check ( public.can_mark_event_attendance(event_id, user_id) and recorded_by = auth.uid() );

drop policy if exists "portal_event_attendance_delete" on public.portal_event_attendance;
create policy "portal_event_attendance_delete"
on public.portal_event_attendance
for delete
to authenticated
using ( public.can_mark_event_attendance(event_id, user_id) );
