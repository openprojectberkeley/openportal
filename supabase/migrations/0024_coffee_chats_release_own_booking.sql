-- Let an applicant cancel (release) their own coffee chat booking.
--
-- The existing coffee_chats UPDATE policy (created in the dashboard before
-- migrations existed) lets a user CLAIM an open slot — the resulting row has
-- applicant_id = auth.uid(), which passes its WITH CHECK. But cancelling sets
-- applicant_id back to NULL, so the resulting row is { applicant_id: null,
-- member_id: <the other person> }. For any chat whose member isn't the actor,
-- that fails the WITH CHECK and Postgres rejects the update — so "Cancel"
-- silently no-ops for every booking except the degenerate case where you are
-- also the member.
--
-- This adds a narrow, additive permissive policy that authorizes exactly the
-- release: an actor may null out a booking that is currently theirs. Permissive
-- policies are OR-combined, so this only widens what's allowed and can't break
-- the existing claim / availability-management flows.
drop policy if exists "coffee_chats_applicant_release" on public.coffee_chats;
create policy "coffee_chats_applicant_release"
on public.coffee_chats
for update
to authenticated
using ( applicant_id = auth.uid() )
with check ( applicant_id is null );
