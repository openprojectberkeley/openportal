-- One-off data fix: record a COMPLETED coffee chat between Varun Dangeti
-- (attendee/booker) and Ashwika Gampa (host) at 12 PM Pacific on 2026-09-02.
--
-- Completion is modeled on the coffee_chats row itself: complete = true,
-- no_show = false (there is no completed_at column). No booked row exists between
-- these two, so this INSERTs one. member_id = host, applicant_id = attendee.
--
-- Note on time: on 2026-09-02 US Pacific is on daylight time (PDT, UTC-7), so
-- "12 PM Pacific" via America/Los_Angeles resolves to 2026-09-02 19:00 UTC.
-- Idempotent: the NOT EXISTS guard prevents a duplicate if re-run.

insert into public.coffee_chats
  (member_id, applicant_id, meeting_time, complete, no_show, duration_minutes)
select
  host.user_id,                                                   -- Ashwika (host)
  guest.user_id,                                                  -- Varun (attendee)
  ('2026-09-02 12:00:00'::timestamp at time zone 'America/Los_Angeles'),
  true,     -- complete
  false,    -- no_show
  15        -- duration_minutes (Ashwika's usual length; change if needed)
from public.members host
join public.members guest on true
where host.email  = 'ashwikag@berkeley.edu'
  and guest.email = 'varundangeti@berkeley.edu'
  and not exists (                                                -- avoid double-insert
    select 1 from public.coffee_chats c
    where c.member_id    = host.user_id
      and c.applicant_id = guest.user_id
      and c.meeting_time = ('2026-09-02 12:00:00'::timestamp at time zone 'America/Los_Angeles')
  );

-- Verify (should return exactly one row, complete = true):
-- select cc.complete, cc.no_show, cc.meeting_time, cc.duration_minutes
-- from public.coffee_chats cc
-- where cc.member_id = '8caa8d33-940a-484e-9510-4846194cc28a'   -- Ashwika
--   and cc.applicant_id = '550e342c-535f-42b3-b9cb-8b990b04ac1c'; -- Varun
