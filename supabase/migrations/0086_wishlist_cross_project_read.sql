-- Let every board/exec reviewer (including PMs) read every project's wishlist,
-- not only their own. Insert/update/delete stay gated on can_review_project()
-- (0073/0075) so a PM still can only mutate their own project's shortlist.
--
-- Mirrors 0076's widening of draft_round_projects SELECT: the Applications
-- manager page is already board/exec-only, and cross-project wishlist visibility
-- is useful competitive signal while reviewing (who else shortlisted this
-- applicant). Applicants still cannot read wishlist rows (is_board_or_exec()
-- is false for them).

drop policy if exists "application_wishlist_select" on public.application_wishlist;
create policy "application_wishlist_select"
on public.application_wishlist
for select
to authenticated
using (public.is_board_or_exec());
