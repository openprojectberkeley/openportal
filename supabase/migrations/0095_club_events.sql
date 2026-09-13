-- Club-wide events: calendar events that belong to no portal.
--
-- The Google Calendar sync (0094) originally landed its events in a dedicated
-- "Open Project" portal. That portal would have had to exist forever, hold
-- every member as a synthetic roster, and be hidden from the portals grid — a
-- lot of machinery to express "this event is for the whole club".
--
-- Instead `portal_id` becomes nullable. A NULL portal means a club event, and
-- visibility is decided purely by role:
--
--   portal_id is null, category <> 'board'  → every signed-in user
--   portal_id is null, category  = 'board'  → is_board_or_exec() only
--   portal_id is not null                   → is_portal_member(), as before
--                                             (still minus board events)
--
-- Management splits by how routine the action is: only exec edits a club event
-- (the same bar as running the sync), but any board member or PM can take
-- attendance at one.

-- 1. A club event has no portal ---------------------------------------------

alter table public.portal_events alter column portal_id drop not null;

-- Lookups for the dashboard's aggregate calendar, which unions club events with
-- the portals the viewer belongs to.
create index if not exists portal_events_club_idx
  on public.portal_events(start_time) where portal_id is null;

-- 2. SELECT: role-gated for club events, portal-gated otherwise --------------

drop policy if exists "portal_events_select" on public.portal_events;
create policy "portal_events_select"
on public.portal_events
for select
to authenticated
using (
  (portal_id is null or public.is_portal_member(portal_id))
  and (category <> 'board' or public.is_board_or_exec())
);

-- 3. Writes: exec for club events, portal admin for portal events ------------

drop policy if exists "portal_events_insert" on public.portal_events;
create policy "portal_events_insert"
on public.portal_events
for insert
to authenticated
with check (
  case
    when portal_id is null then public.is_exec()
    else public.is_portal_admin(portal_id) and created_by = auth.uid()
  end
);

drop policy if exists "portal_events_update" on public.portal_events;
create policy "portal_events_update"
on public.portal_events
for update
to authenticated
using (
  case when portal_id is null then public.is_exec() else public.is_portal_admin(portal_id) end
)
with check (
  case when portal_id is null then public.is_exec() else public.is_portal_admin(portal_id) end
);

drop policy if exists "portal_events_delete" on public.portal_events;
create policy "portal_events_delete"
on public.portal_events
for delete
to authenticated
using (
  case when portal_id is null then public.is_exec() else public.is_portal_admin(portal_id) end
);

-- 4. Attendance: board/exec for club events, portal admin otherwise ----------
--
-- Supersedes is_event_portal_admin() (0011), whose name no longer describes
-- what it decides now that an event can have no portal. That function is left
-- in place (nothing else calls it) rather than dropped, so re-running older
-- migrations stays safe.

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
            when e.portal_id is null then public.is_board_or_exec()
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
using ( user_id = auth.uid() or public.can_take_event_attendance(event_id) );

drop policy if exists "portal_event_attendance_insert" on public.portal_event_attendance;
create policy "portal_event_attendance_insert"
on public.portal_event_attendance
for insert
to authenticated
with check ( public.can_take_event_attendance(event_id) and recorded_by = auth.uid() );

drop policy if exists "portal_event_attendance_update" on public.portal_event_attendance;
create policy "portal_event_attendance_update"
on public.portal_event_attendance
for update
to authenticated
using ( public.can_take_event_attendance(event_id) )
with check ( public.can_take_event_attendance(event_id) and recorded_by = auth.uid() );

drop policy if exists "portal_event_attendance_delete" on public.portal_event_attendance;
create policy "portal_event_attendance_delete"
on public.portal_event_attendance
for delete
to authenticated
using ( public.can_take_event_attendance(event_id) );
