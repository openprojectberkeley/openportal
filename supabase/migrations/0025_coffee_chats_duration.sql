-- Add a per-appointment duration to coffee_chats.
--
-- Coffee chats were previously modeled as hour-long blocks: one selected
-- hour tile in the manager's availability grid became a single group
-- session (slotCapacity duplicate rows sharing one meeting_time). Real
-- coffee chats run 15/20/30 minutes, and since those all divide 60 evenly,
-- an hour tile now expands into that many real back-to-back sub-slots
-- (15m -> 4, 20m -> 3, 30m -> 2), each with its own meeting_time and a
-- duration-driven seat count (15m -> 1 seat, 20m -> 2, 30m -> 3). This
-- column records that duration per row so the calendar-invite helpers
-- (src/lib/gcal.ts, src/lib/ics.ts) and the UI can show the real length
-- instead of the previous implicit 60-minute assumption.
--
-- All rows sharing a meeting_time represent one sub-slot and must carry the
-- same duration; that invariant is enforced by the application write path
-- (the manager grid always writes/updates a whole sub-slot's seat rows
-- together), not by a DB constraint, consistent with how the existing
-- group-booking model already isn't fully constrained in the DB.
--
-- Existing rows (created under the old hour-block model, before this column
-- existed) backfill to 30 minutes. This only affects calendar-invite length
-- and display for already-scheduled chats; their existing seat rows are
-- untouched.
alter table public.coffee_chats
  add column if not exists duration_minutes integer not null default 30;

alter table public.coffee_chats
  drop constraint if exists coffee_chats_duration_minutes_check;
alter table public.coffee_chats
  add constraint coffee_chats_duration_minutes_check
  check (duration_minutes in (15, 20, 30));
