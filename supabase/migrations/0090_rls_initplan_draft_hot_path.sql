-- Stop the draft/application RLS policies from re-evaluating their helper
-- functions once per row.
--
-- pg_stat_statements shows five queries burning 74% of all database CPU (514s
-- of 697s) across ~213 calls, averaging 1.0-4.6s each -- against tables holding
-- 129 (draft_round_projects) and 269 (draft_picks) rows. It is not data volume,
-- it is the policies. EXPLAIN under a board user's JWT shows what Postgres
-- actually applies to draft_round_projects:
--
--   Filter: (can_review_project(project_id) OR is_board_or_exec()
--            OR can_review_all_projects())
--
-- Three permissive SELECT policies (0072 + 0076), OR'd, evaluated per row, and
-- each one expands: can_review_project -> can_review_all_projects -> is_vp_tech
-- OR is_president OR is_vp_projects, each of which seq-scans members_roles and
-- joins roles. draft_picks_select (0072) then runs a correlated EXISTS back
-- into draft_round_projects, which re-applies all three of its own policies per
-- row. The counters show the multiplication: 194,152 seq scans of members_roles
-- (a 47-row table), 307,832 index scans of roles, 107,485 seq scans of
-- project_members.
--
-- Three fixes, none of which change who can see what:
--
--   1. Wrap the row-independent helpers in a scalar subquery --
--      (select public.is_board_or_exec()) rather than is_board_or_exec().
--      Postgres hoists those to an InitPlan evaluated once per query instead of
--      once per row. This is the first migration here to use the pattern; it is
--      what Supabase's auth_rls_initplan linter has been flagging 43 times.
--
--   2. can_review_project(project_id) takes the row, so it can never be
--      hoisted. Replace it in policies with a set-returning SECURITY DEFINER
--      helper, pm_project_ids(), used as `x in (select public.pm_project_ids())`
--      -- a hashed SubPlan computed once. Same trick 0089 used to fix the
--      Applications list timeout with application_ids_reviewable_as_pm().
--      can_review_project() itself is left alone: submit_draft_picks (0088),
--      unsubmit_draft_picks (0082) and set_round_submitted (0079) call it once
--      per statement, where it costs nothing.
--
--   3. Collapse policies that overlap on SELECT, so only one is evaluated.
--      Equivalence is argued per table below.
--
-- Scope is the hot path only: the draft tables plus the application review
-- tables. The cold-path policies (coffee_chats, notifications, members,
-- infosesh_attendance, portals, projects, portal_*) still use bare auth.uid()
-- and stay flagged by the linter -- they are a rounding error on CPU today.
--
-- Also ANALYZE the tables in this path. roles and draft_rounds have never been
-- analyzed at all (reltuples = -1, no pg_statistic rows), and roles is joined
-- by every is_board_or_exec()/is_vp_tech() call, so the planner has been
-- choosing these plans blind.

-- 1. PM project ids as a once-computed set -----------------------------------
-- SECURITY DEFINER so it does not recurse into project_members RLS, STABLE so
-- it can be hoisted. Mirrors application_ids_reviewable_as_pm() (0089).

create or replace function public.pm_project_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select pm.project_id
  from public.project_members pm
  where pm.user_id = auth.uid()
    and pm.is_pm;
$$;

grant execute on function public.pm_project_ids() to authenticated;

-- 2. draft_round_projects: 3 policies -> 2 -----------------------------------
-- draft_round_projects_select_reviewable (0072, can_review_project(project_id))
-- is fully redundant against the board policy 0076 added. is_board_or_exec() is
-- is_pm() OR board/exec role (0016), and is_pm() is true for a PM of ANY
-- project -- so if can_review_project(p) holds via its PM arm, is_board_or_exec()
-- already holds; if it holds via can_review_all_projects(), that is the other
-- arm kept below. The dropped predicate implies the disjunction of the two
-- retained ones, so visibility is unchanged. That is consistent with 0076,
-- which deliberately widened this table's SELECT to the whole board.
--
-- The old "for all" policy (0070/0071) also covered SELECT, which is what
-- created the three-way overlap; split it into explicit write policies.

drop policy if exists "draft_round_projects_all" on public.draft_round_projects;
drop policy if exists "draft_round_projects_select_board" on public.draft_round_projects;
drop policy if exists "draft_round_projects_select_reviewable" on public.draft_round_projects;

drop policy if exists "draft_round_projects_select" on public.draft_round_projects;
create policy "draft_round_projects_select"
on public.draft_round_projects
for select
to authenticated
using (
  (select public.is_board_or_exec())
  or (select public.can_review_all_projects())
);

drop policy if exists "draft_round_projects_insert" on public.draft_round_projects;
create policy "draft_round_projects_insert"
on public.draft_round_projects
for insert
to authenticated
with check ( (select public.can_review_all_projects()) );

drop policy if exists "draft_round_projects_update" on public.draft_round_projects;
create policy "draft_round_projects_update"
on public.draft_round_projects
for update
to authenticated
using ( (select public.can_review_all_projects()) )
with check ( (select public.can_review_all_projects()) );

drop policy if exists "draft_round_projects_delete" on public.draft_round_projects;
create policy "draft_round_projects_delete"
on public.draft_round_projects
for delete
to authenticated
using ( (select public.can_review_all_projects()) );

-- 3. draft_rounds: same "for all" + board-select overlap ---------------------

drop policy if exists "draft_rounds_all" on public.draft_rounds;
drop policy if exists "draft_rounds_select_board" on public.draft_rounds;

drop policy if exists "draft_rounds_select" on public.draft_rounds;
create policy "draft_rounds_select"
on public.draft_rounds
for select
to authenticated
using (
  (select public.is_board_or_exec())
  or (select public.can_review_all_projects())
);

drop policy if exists "draft_rounds_insert" on public.draft_rounds;
create policy "draft_rounds_insert"
on public.draft_rounds
for insert
to authenticated
with check ( (select public.can_review_all_projects()) );

drop policy if exists "draft_rounds_update" on public.draft_rounds;
create policy "draft_rounds_update"
on public.draft_rounds
for update
to authenticated
using ( (select public.can_review_all_projects()) )
with check ( (select public.can_review_all_projects()) );

drop policy if exists "draft_rounds_delete" on public.draft_rounds;
create policy "draft_rounds_delete"
on public.draft_rounds
for delete
to authenticated
using ( (select public.can_review_all_projects()) );

-- 4. draft_state: same shape again -------------------------------------------

drop policy if exists "draft_state_all" on public.draft_state;
drop policy if exists "draft_state_select_board" on public.draft_state;

drop policy if exists "draft_state_select" on public.draft_state;
create policy "draft_state_select"
on public.draft_state
for select
to authenticated
using (
  (select public.is_board_or_exec())
  or (select public.can_review_all_projects())
);

drop policy if exists "draft_state_insert" on public.draft_state;
create policy "draft_state_insert"
on public.draft_state
for insert
to authenticated
with check ( (select public.can_review_all_projects()) );

drop policy if exists "draft_state_update" on public.draft_state;
create policy "draft_state_update"
on public.draft_state
for update
to authenticated
using ( (select public.can_review_all_projects()) )
with check ( (select public.can_review_all_projects()) );

drop policy if exists "draft_state_delete" on public.draft_state;
create policy "draft_state_delete"
on public.draft_state
for delete
to authenticated
using ( (select public.can_review_all_projects()) );

-- 5. draft_picks: 2 SELECT policies -> 1, still project-scoped ---------------
-- NOT collapsed the way draft_round_projects was, deliberately. draft_picks_select
-- (0072) grants a PM their OWN project's staged picks; is_board_or_exec() is
-- true for a PM of any project, so substituting it would leak every project's
-- staged picks cross-project -- exactly the line 0088 draws (staged is private
-- to the owning project, only confirmed is board-wide).
--
-- Merging the two policies is still safe because draft_round_projects.id is the
-- primary key, so at most one rp row matches a given round_project_id:
--
--   A: exists(rp: rp.id = X and can_review_project(rp.project_id))
--   B: is_board_or_exec() and exists(rp: rp.id = X and rp.submitted_at not null)
--   A or B  ==  exists(rp: rp.id = X and (crp(rp.project_id)
--                                         or (ibe() and rp.submitted_at not null)))
--
-- Written as an uncorrelated `X in (select ...)` it becomes one hashed SubPlan
-- computed once per query instead of a correlated EXISTS per pick row. The
-- inner scan still goes through draft_round_projects' own RLS, which section 2
-- just made an InitPlan, and the where clause below re-gates it regardless.

drop policy if exists "draft_picks_select" on public.draft_picks;
drop policy if exists "draft_picks_select_confirmed_board" on public.draft_picks;
create policy "draft_picks_select"
on public.draft_picks
for select
to authenticated
using (
  draft_picks.round_project_id in (
    select rp.id
    from public.draft_round_projects rp
    where rp.project_id in (select public.pm_project_ids())
       or (select public.can_review_all_projects())
       or ((select public.is_board_or_exec()) and rp.submitted_at is not null)
  )
);

drop policy if exists "draft_picks_insert" on public.draft_picks;
create policy "draft_picks_insert"
on public.draft_picks
for insert
to authenticated
with check (
  draft_picks.round_project_id in (
    select rp.id
    from public.draft_round_projects rp
    where rp.project_id in (select public.pm_project_ids())
       or (select public.can_review_all_projects())
  )
);

-- Staged picks can be un-staged; a confirmed round's picks can't be pulled
-- back out through a raw delete (0072).
drop policy if exists "draft_picks_delete" on public.draft_picks;
create policy "draft_picks_delete"
on public.draft_picks
for delete
to authenticated
using (
  draft_picks.round_project_id in (
    select rp.id
    from public.draft_round_projects rp
    where rp.submitted_at is null
      and ( rp.project_id in (select public.pm_project_ids())
            or (select public.can_review_all_projects()) )
  )
);

-- 6. draft_wishlist_entries: split "for all", keep project scoping -----------
-- Same leak reasoning as draft_picks -- do NOT widen to is_board_or_exec().

drop policy if exists "draft_wishlist_entries_all" on public.draft_wishlist_entries;

drop policy if exists "draft_wishlist_entries_select" on public.draft_wishlist_entries;
create policy "draft_wishlist_entries_select"
on public.draft_wishlist_entries
for select
to authenticated
using (
  draft_wishlist_entries.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
);

drop policy if exists "draft_wishlist_entries_insert" on public.draft_wishlist_entries;
create policy "draft_wishlist_entries_insert"
on public.draft_wishlist_entries
for insert
to authenticated
with check (
  draft_wishlist_entries.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
);

drop policy if exists "draft_wishlist_entries_update" on public.draft_wishlist_entries;
create policy "draft_wishlist_entries_update"
on public.draft_wishlist_entries
for update
to authenticated
using (
  draft_wishlist_entries.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
)
with check (
  draft_wishlist_entries.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
);

drop policy if exists "draft_wishlist_entries_delete" on public.draft_wishlist_entries;
create policy "draft_wishlist_entries_delete"
on public.draft_wishlist_entries
for delete
to authenticated
using (
  draft_wishlist_entries.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
);

-- 7. application_wishlist -----------------------------------------------------
-- SELECT is already board-wide by design (0086) -- just hoist it. Writes stay
-- project-scoped (0073/0075), now via pm_project_ids().

drop policy if exists "application_wishlist_select" on public.application_wishlist;
create policy "application_wishlist_select"
on public.application_wishlist
for select
to authenticated
using ( (select public.is_board_or_exec()) );

drop policy if exists "application_wishlist_insert" on public.application_wishlist;
create policy "application_wishlist_insert"
on public.application_wishlist
for insert
to authenticated
with check (
  application_wishlist.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
);

drop policy if exists "application_wishlist_update" on public.application_wishlist;
create policy "application_wishlist_update"
on public.application_wishlist
for update
to authenticated
using (
  application_wishlist.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
)
with check (
  application_wishlist.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
);

drop policy if exists "application_wishlist_delete" on public.application_wishlist;
create policy "application_wishlist_delete"
on public.application_wishlist
for delete
to authenticated
using (
  application_wishlist.project_id in (select public.pm_project_ids())
  or (select public.can_review_all_projects())
);

-- 8. applications -------------------------------------------------------------
-- Same authorization as 0057/0089; the PM arm already uses the hashed-SubPlan
-- form, so this only hoists the other two.

drop policy if exists "applications_select" on public.applications;
create policy "applications_select"
on public.applications
for select
to authenticated
using (
  applicant_id = (select auth.uid())
  or (select public.can_review_all_projects())
  or applications.id in (select public.application_ids_reviewable_as_pm())
);

drop policy if exists "applications_insert" on public.applications;
create policy "applications_insert"
on public.applications
for insert
to authenticated
with check (
  applicant_id = (select auth.uid())
  and public.period_is_open_for(period_id)
);

drop policy if exists "applications_update" on public.applications;
create policy "applications_update"
on public.applications
for update
to authenticated
using (
  applicant_id = (select auth.uid())
  and public.period_is_open_for(period_id)
)
with check (
  applicant_id = (select auth.uid())
  and public.period_is_open_for(period_id)
);

-- 9. application_rankings ------------------------------------------------------
-- Board-wide SELECT since 0087; applicant-owner branch unchanged. The EXISTS
-- stays correlated (it is a primary-key probe into applications), but
-- is_board_or_exec()/is_returning_member()/auth.uid() are now hoisted, which is
-- where the per-row cost actually was.

drop policy if exists "application_rankings_select" on public.application_rankings;
create policy "application_rankings_select"
on public.application_rankings
for select
to authenticated
using (
  (select public.is_board_or_exec())
  or exists (
    select 1
    from public.applications a
    where a.id = application_rankings.application_id
      and a.applicant_id = (select auth.uid())
  )
);

drop policy if exists "application_rankings_insert" on public.application_rankings;
create policy "application_rankings_insert"
on public.application_rankings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.applications a
    where a.id = application_rankings.application_id
      and a.applicant_id = (select auth.uid())
      and public.period_is_open_for(a.period_id)
  )
  and (
    (select public.is_returning_member())
    or exists (
      select 1
      from public.projects p
      where p.id = application_rankings.project_id
        and p.type = 'launch'
    )
  )
);

drop policy if exists "application_rankings_update" on public.application_rankings;
create policy "application_rankings_update"
on public.application_rankings
for update
to authenticated
using (
  exists (
    select 1
    from public.applications a
    where a.id = application_rankings.application_id
      and a.applicant_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.applications a
    where a.id = application_rankings.application_id
      and a.applicant_id = (select auth.uid())
      and public.period_is_open_for(a.period_id)
  )
  and (
    (select public.is_returning_member())
    or exists (
      select 1
      from public.projects p
      where p.id = application_rankings.project_id
        and p.type = 'launch'
    )
  )
);

drop policy if exists "application_rankings_delete" on public.application_rankings;
create policy "application_rankings_delete"
on public.application_rankings
for delete
to authenticated
using (
  exists (
    select 1
    from public.applications a
    where a.id = application_rankings.application_id
      and a.applicant_id = (select auth.uid())
      and public.period_is_open_for(a.period_id)
  )
);

-- 10. application_answers -------------------------------------------------------
-- Board-wide SELECT since 0087; applicant-owner branch unchanged.

drop policy if exists "application_answers_select" on public.application_answers;
create policy "application_answers_select"
on public.application_answers
for select
to authenticated
using (
  (select public.is_board_or_exec())
  or exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = (select auth.uid())
  )
);

drop policy if exists "application_answers_insert" on public.application_answers;
create policy "application_answers_insert"
on public.application_answers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = (select auth.uid())
      and public.period_is_open_for(a.period_id)
  )
);

drop policy if exists "application_answers_update" on public.application_answers;
create policy "application_answers_update"
on public.application_answers
for update
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = (select auth.uid())
      and public.period_is_open_for(a.period_id)
  )
);

drop policy if exists "application_answers_delete" on public.application_answers;
create policy "application_answers_delete"
on public.application_answers
for delete
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = (select auth.uid())
      and public.period_is_open_for(a.period_id)
  )
);

-- 11. Statistics ---------------------------------------------------------------
-- roles and draft_rounds have never been analyzed (reltuples = -1). ANALYZE is
-- transaction-safe, so this is fine inside a migration.

analyze public.roles;
analyze public.members_roles;
analyze public.project_members;
analyze public.draft_rounds;
analyze public.draft_round_projects;
analyze public.draft_picks;
analyze public.draft_state;
analyze public.draft_wishlist_entries;
analyze public.applications;
analyze public.application_rankings;
analyze public.application_answers;
analyze public.application_wishlist;
analyze public.application_periods;

notify pgrst, 'reload schema';

-- Rollback ---------------------------------------------------------------------
-- To restore the pre-0090 policies, drop the ones created above and re-run the
-- originals from: 0057 (applications_*, application_rankings_*,
-- application_answers_*, can_review_project), 0070/0071 (draft_rounds_all,
-- draft_round_projects_all, draft_state_all), 0072 (draft_picks_*,
-- draft_round_projects_select_reviewable, draft_rounds_select_board,
-- draft_state_select_board), 0073/0075 (application_wishlist writes),
-- 0086 (application_wishlist_select), 0087 (application_rankings_select,
-- application_answers_select), 0088 (draft_picks_select_confirmed_board),
-- 0089 (applications_select). pm_project_ids() can be left in place -- nothing
-- outside this migration references it.
