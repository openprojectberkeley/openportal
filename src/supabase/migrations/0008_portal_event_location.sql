-- Add an optional location to portal events.
alter table public.portal_events add column if not exists location text;
