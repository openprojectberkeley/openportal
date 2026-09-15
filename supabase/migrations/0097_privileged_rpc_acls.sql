-- Take every privileged RPC off the unauthenticated surface, for real this time.
--
-- The bug is in a line this schema has repeated since 0022:
--
--   grant execute on function public.f(...) to authenticated;
--   revoke execute on function public.f(...) from anon;
--
-- The revoke does not do what the comment next to it claims. A new function's
-- default ACL carries a grant to PUBLIC -- the `=X/postgres` entry in proacl --
-- and `anon` is a member of PUBLIC, so revoking the role-specific grant leaves
-- the PUBLIC one standing and has_function_privilege('anon', f, 'execute') is
-- still true. Supabase's default privileges then add an explicit anon grant on
-- top for good measure, which some of these never revoked at all.
--
-- Net effect today: 20 SECURITY DEFINER functions that accept, reject, draft,
-- place and de-member people -- plus every recruiting analytics RPC -- are
-- callable by a logged-out client over PostgREST.
--
-- How bad: not a hole. Every one of them opens with is_board_or_exec(),
-- can_review_all_projects() or an equivalent, and auth.uid() is null for anon,
-- so the call raises 'not authorized' before touching a row. This is exposed
-- endpoint surface, not privilege escalation, and it is worth closing on its own
-- terms: an unauthenticated caller should get a 404 from PostgREST rather than
-- reach our code at all, and the next function written against this pattern may
-- not be so careful about checking first.
--
-- The fix is `from public, anon` rather than `from anon`. Every function below
-- already holds an explicit `authenticated=X/postgres` grant, verified before
-- writing this, so dropping PUBLIC costs no real caller anything -- the grant
-- the app actually travels on is re-stated here anyway, so this file is the
-- whole truth about who may call these.
--
-- Deliberately untouched:
--
--   prevent_self_status_change()  a trigger function. It returns `trigger`, so
--                                 PostgREST will not expose it whatever its ACL
--                                 says, and EXECUTE on a trigger function is
--                                 checked at CREATE TRIGGER time, not on each
--                                 fire. Revoking would be noise.
--   draft_destination_round_project()  already correct (0091 revoked public,
--                                 anon AND authenticated -- it mutates
--                                 pick_count and is definer-internal).
--   search_addable_members(), add_member_to_draft()  already correct (0096).
--
-- Nothing here changes a function body; this file is grants only.

-- Applications: review outcomes ------------------------------------------------

revoke execute on function public.accept_application(uuid, uuid) from public, anon;
grant  execute on function public.accept_application(uuid, uuid) to authenticated;

revoke execute on function public.reject_application(uuid) from public, anon;
grant  execute on function public.reject_application(uuid) to authenticated;

-- Draft: picks and rounds -------------------------------------------------------

revoke execute on function public.add_draft_pick(uuid, uuid, uuid) from public, anon;
grant  execute on function public.add_draft_pick(uuid, uuid, uuid) to authenticated;

revoke execute on function public.move_draft_pick(uuid, uuid) from public, anon;
grant  execute on function public.move_draft_pick(uuid, uuid) to authenticated;

revoke execute on function public.set_draft_outcome(uuid, uuid, text) from public, anon;
grant  execute on function public.set_draft_outcome(uuid, uuid, text) to authenticated;

revoke execute on function public.submit_draft_picks(uuid) from public, anon;
grant  execute on function public.submit_draft_picks(uuid) to authenticated;

revoke execute on function public.unsubmit_draft_picks(uuid) from public, anon;
grant  execute on function public.unsubmit_draft_picks(uuid) to authenticated;

revoke execute on function public.set_round_submitted(uuid, boolean) from public, anon;
grant  execute on function public.set_round_submitted(uuid, boolean) to authenticated;

revoke execute on function public.complete_draft(uuid) from public, anon;
grant  execute on function public.complete_draft(uuid) to authenticated;

revoke execute on function public.reset_draft(uuid) from public, anon;
grant  execute on function public.reset_draft(uuid) to authenticated;

-- Members and recruiting state ---------------------------------------------------

revoke execute on function public.set_member_status(uuid, public.member_status) from public, anon;
grant  execute on function public.set_member_status(uuid, public.member_status) to authenticated;

revoke execute on function public.set_applicant_coffee_chat(uuid, text, uuid) from public, anon;
grant  execute on function public.set_applicant_coffee_chat(uuid, text, uuid) to authenticated;

revoke execute on function public.set_applicant_infosession(uuid, boolean) from public, anon;
grant  execute on function public.set_applicant_infosession(uuid, boolean) to authenticated;

revoke execute on function public.notify_coffee_chat_counterparty(uuid, text, text) from public, anon;
grant  execute on function public.notify_coffee_chat_counterparty(uuid, text, text) to authenticated;

-- Recruiting analytics -----------------------------------------------------------
-- These never revoked anon at all; they are board/exec-gated reads over the whole
-- applicant pool, so they belong behind a session like everything else.

revoke execute on function public.application_analytics() from public, anon;
grant  execute on function public.application_analytics() to authenticated;

revoke execute on function public.application_analytics_invalid(uuid) from public, anon;
grant  execute on function public.application_analytics_invalid(uuid) to authenticated;

revoke execute on function public.application_period_stats(uuid) from public, anon;
grant  execute on function public.application_period_stats(uuid) to authenticated;

revoke execute on function public.application_demographics(uuid) from public, anon;
grant  execute on function public.application_demographics(uuid) to authenticated;

revoke execute on function public.application_project_rankings(uuid) from public, anon;
grant  execute on function public.application_project_rankings(uuid) to authenticated;

revoke execute on function public.application_period_draft_applicants(uuid) from public, anon;
grant  execute on function public.application_period_draft_applicants(uuid) to authenticated;

notify pgrst, 'reload schema';

-- A note for whoever writes the next RPC: `revoke ... from anon` alone is not
-- enough, and neither is relying on the body's own authorization check to make
-- the grant not matter. The pattern that works is
--
--   revoke execute on function public.f(...) from public, anon;
--   grant  execute on function public.f(...) to authenticated;
--
-- in that order. Confirm with has_function_privilege('anon', 'public.f(...)',
-- 'execute') -- it should come back false.

-- Rollback -------------------------------------------------------------------
-- Restores the (over-broad) grants this file removed:
--   grant execute on function public.<each function above> to public;
-- Nothing else changed -- no bodies, no policies, no data.
