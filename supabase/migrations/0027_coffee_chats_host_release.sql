-- Let a host (the member being booked) cancel a booking on their OWN slot.
--
-- The pre-existing dashboard UPDATE policy lets a member edit their own
-- coffee_chats rows (e.g. toggling `complete`), but its WITH CHECK does not
-- authorize setting applicant_id -> null on a seat someone else holds. Mirror
-- 0024 (which did this for the applicant side) with a narrow, additive
-- permissive policy that authorizes exactly the host release: a member may null
-- out a booking on a slot they own. Permissive policies are OR-combined, so
-- this only widens what's allowed and can't break existing flows.
drop policy if exists "coffee_chats_host_release" on public.coffee_chats;
create policy "coffee_chats_host_release"
on public.coffee_chats
for update
to authenticated
using ( member_id = auth.uid() )
with check ( applicant_id is null );
