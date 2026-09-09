-- Let every board/exec reviewer (including PMs) read every ranked project's
-- rankings and answers in the review modal, not only projects they PM.
-- Accept/reject and wishlist writes stay gated on can_review_project()
-- (0057/0073/0075) so a PM still can only place onto / shortlist their own
-- project. applications_select + application_has_reviewable_ranking stay
-- scoped — PMs still only see applicants who ranked a project they PM in the
-- list; this only widens what they see once they open Review.
--
-- Mirrors 0086's wishlist SELECT widening: the Applications manager page is
-- already board/exec-only. Applicants still read their own rows via the
-- applicant-owner branch (is_board_or_exec() is false for them).

drop policy if exists "application_rankings_select" on public.application_rankings;
create policy "application_rankings_select"
on public.application_rankings
for select
to authenticated
using (
  public.is_board_or_exec()
  or exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_select" on public.application_answers;
create policy "application_answers_select"
on public.application_answers
for select
to authenticated
using (
  public.is_board_or_exec()
  or exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);
