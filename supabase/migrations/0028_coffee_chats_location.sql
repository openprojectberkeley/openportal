-- Coffee-chat location / meeting link.
--
-- Adds a per-seat `location` (a Zoom/Meet link or a physical place) plus a
-- host-level default on `members` that new availability inherits. Hosts edit
-- both; applicants see the location on their booked chat and in the calendar
-- link. `members.default_chat_location` rides the existing member self-update
-- RLS (the profile flow already updates members where user_id = auth.uid()).
alter table public.coffee_chats
  add column if not exists location text;

alter table public.members
  add column if not exists default_chat_location text;

-- Make host edits of their own coffee_chats rows explicit and version
-- controlled. This likely overlaps the invisible dashboard member-update
-- policy; harmless because permissive policies are OR-combined.
drop policy if exists "coffee_chats_host_update_own" on public.coffee_chats;
create policy "coffee_chats_host_update_own"
on public.coffee_chats
for update
to authenticated
using ( member_id = auth.uid() )
with check ( member_id = auth.uid() );
