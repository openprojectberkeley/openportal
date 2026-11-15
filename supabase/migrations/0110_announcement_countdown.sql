-- Optional countdown timer on an announcement.
--
-- When set, the banner shows a live days/hours/minutes/seconds countdown to
-- this moment, in the same style as the application-deadline band. Separate
-- from ends_at (the display window), so e.g. a week-long "GM Thursday 7pm"
-- banner can count down to the meeting itself. Null = no timer. Once the
-- moment passes the timer drops off and the message stays until ends_at.
--
-- No RLS change: reads/writes ride on the existing 0107 announcements policies.

alter table public.announcements
  add column if not exists countdown_at timestamptz;

comment on column public.announcements.countdown_at is
  'Optional moment the banner counts down to. Null = no timer.';
