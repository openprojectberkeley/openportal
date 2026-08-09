-- Store each member's auth sign-in email on their profile row so managers can
-- read it (e.g. the coffee-chat attendee hover tooltip). It is written at
-- onboarding and backfilled on sign-in when missing.
alter table public.members
  add column if not exists email text;
