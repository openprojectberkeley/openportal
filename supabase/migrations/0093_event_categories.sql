-- Event categories: an organizing layer over portal_events.
--
-- Until now an event's only visual identity came from its portal (name + color,
-- via the portals(name, color) embed the calendar panel selects). That's too
-- coarse once a single portal holds the whole club schedule — general meetings,
-- info sessions, socials and board meetings all look identical.
--
-- `category`           groups events by kind; drives card color + filter chips.
-- `attendance_enabled` opts an event into the portal_event_attendance flow
--                      (0011), so socials don't clutter the attendance modal.
-- `category_overridden` marks a category set by hand, so the Google Calendar
--                      sync (0094) never stomps a manual re-categorization.
--
-- Text + check constraint rather than a pg enum, matching portals.type (0012)
-- and portal_event_attendance.status (0011) — adding a value later is an ALTER
-- of the constraint, not an enum migration.

alter table public.portal_events
  add column if not exists category text not null default 'general',
  add column if not exists attendance_enabled boolean not null default false,
  add column if not exists category_overridden boolean not null default false;

alter table public.portal_events drop constraint if exists portal_events_category_check;
alter table public.portal_events
  add constraint portal_events_category_check
  check (category in ('general', 'gm', 'recruitment', 'milestone', 'social', 'board'));

-- The calendar filters by category on every read once the chips are in use.
create index if not exists portal_events_category_idx on public.portal_events(category);

-- Board events are gated by ROLE, not by portal membership: a board meeting
-- sitting in the club-wide portal must stay invisible to ordinary members of
-- that portal. is_board_or_exec() (0002) is exactly
-- `roles.access_level in ('board','exec')`, the same grouping used by
-- infosession attendance and the application-validity rules.
--
-- Replaces the policy from 0006_portals.sql. Applies to hand-created events
-- too, which is intended — tagging any event 'board' makes it board-only.
drop policy if exists "portal_events_select" on public.portal_events;
create policy "portal_events_select"
on public.portal_events
for select
to authenticated
using (
  public.is_portal_member(portal_id)
  and (category <> 'board' or public.is_board_or_exec())
);
