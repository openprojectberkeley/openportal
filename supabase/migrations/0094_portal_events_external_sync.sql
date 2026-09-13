-- External calendar sync: let portal_events mirror a Google Calendar.
--
-- The club's real schedule lives in a Google Calendar. Rather than embedding it
-- in an iframe (a sealed box — no attendance, no filtering, no theming), the
-- sync route pulls each occurrence in as a real portal_events row, so synced
-- events get everything native ones have: attendance (0011), .ics export,
-- category colors (0093) and the existing month grid.
--
-- `external_id` is Google's PER-INSTANCE event id (from events.list with
-- singleEvents=true), e.g. `46b5c2ancfgeumbndmn6rvmth5_20260924T030000Z`. It is
-- stable across syncs, which is what makes attendance rows survive: a recurring
-- weekly GM becomes N discrete rows with N stable ids, not one row that moves.
--
-- `external_etag` lets the sync skip writes for unchanged events.
-- `external_link` is Google's htmlLink, for a "view in Google Calendar" jump.

alter table public.portal_events
  add column if not exists external_source text,
  add column if not exists external_id     text,
  add column if not exists external_etag   text,
  add column if not exists external_link   text,
  add column if not exists synced_at       timestamptz,
  add column if not exists cancelled_at    timestamptz;

alter table public.portal_events drop constraint if exists portal_events_external_source_check;
alter table public.portal_events
  add constraint portal_events_external_source_check
  check (external_source is null or external_source in ('gcal'));

-- An external id is meaningless without knowing which system it came from.
alter table public.portal_events drop constraint if exists portal_events_external_pair_check;
alter table public.portal_events
  add constraint portal_events_external_pair_check
  check ((external_source is null) = (external_id is null));

-- Natural key for the sync's idempotent upserts. Partial, so the many
-- hand-created events (external_id null) are unaffected.
create unique index if not exists portal_events_external_id_idx
  on public.portal_events(external_source, external_id)
  where external_id is not null;

-- Deleting an event in Google must NOT hard-delete the row here:
-- portal_event_attendance.event_id is `on delete cascade` (0011), so a delete
-- would silently destroy the attendance history for a meeting that did happen.
-- The sync stamps cancelled_at instead and the UI filters it out.
create index if not exists portal_events_cancelled_at_idx
  on public.portal_events(cancelled_at)
  where cancelled_at is null;
