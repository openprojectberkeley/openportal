-- Exec-only roster surgery on the cross-project draft board (?project=all on
-- /manager/applications): a three-state outcome per card, "move to another
-- project", and "add an applicant to this project" -- all of which must work
-- against round-projects that are already submitted (confirmed).
--
-- Why this needs a migration at all: RLS on draft_picks (0072, re-shaped in
-- 0090) allows INSERT for can_review_all_projects(), allows DELETE only while
-- draft_round_projects.submitted_at is null, and has NO UPDATE policy. A move
-- across confirmed columns is therefore impossible from the client by
-- construction, and stays that way -- this migration deliberately adds no
-- UPDATE policy. The three actions are SECURITY DEFINER RPCs instead.
--
--   1. draft_picks_guard(): a narrow admin override, plus two rule changes.
--
--      (a) Override. A transaction-local GUC app.draft_admin_override = 'on'
--          suppresses exactly two checks -- "this round has already been
--          submitted" and "the draft window is full" -- and only when the
--          caller also passes can_review_all_projects(). The status, period
--          and already-claimed checks always run, for every caller. Only the
--          definer functions below ever set the GUC, immediately around a
--          single INSERT, exactly as 0065's sync_activate_member() does with
--          app.member_status_sync. The extra can_review_all_projects() gate is
--          belt and braces: even a forged GUC buys a PM nothing.
--
--          This is why move_draft_pick() below is a DELETE + INSERT rather
--          than an UPDATE of round_project_id. The trigger is BEFORE INSERT
--          only, so an UPDATE would fire nothing and skip *every* invariant,
--          forcing each one to be re-implemented (and kept in sync forever) in
--          the function. Going back through INSERT keeps one copy of the rules.
--          It also makes the claimed check come out right: deleting the source
--          pick first means the guard sees a period in which this applicant is
--          no longer claimed by the source project, so confirmed -> confirmed
--          is legal while a genuine double-claim still raises. Both statements
--          live in one function, so a failing insert rolls the delete back.
--
--      (b) Rejected picks no longer consume a slot. 0083 rejected an applicant
--          by deleting their picks, which freed the slot as a side effect.
--          set_draft_outcome(...,'rejected') below deliberately KEEPS the pick
--          so the card stays on the board with a red badge -- so the capacity
--          count has to skip rejected rows explicitly, or 0083's documented
--          "frees slots" behaviour silently regresses. This only ever loosens
--          capacity, and only for picks complete_draft can never place.
--
--      (c) New check: the application must belong to the round's period. The
--          PM-side picker is already period-scoped so this can only catch a
--          bug, but the exec's new "+" picker takes an arbitrary application
--          id. Only a mismatch raises -- a null period_id (0022 added the
--          column "on delete set null") still passes.
--
--   2. draft_destination_round_project(period, project, prefer_submitted):
--      which round-project a pick lands in. Prefers matching submitted-ness
--      (so a move never demotes Confirmed -> Staged), then headroom, then the
--      earliest round; bumps pick_count when the winner is full. Revoked from
--      public AND from anon/authenticated (Supabase's default privileges grant
--      those two on anything created in public) -- it mutates pick_count and
--      has no auth check of its own, so its callers do the gating.
--
--   3. set_draft_outcome(application, project, 'drafted'|'accepted'|'rejected'):
--      the per-card dropdown. 'accepted' delegates to accept_application()
--      (0057) so placement stays one implementation. 'rejected' is NOT
--      reject_application() (0083), whose closing statement deletes every
--      draft_pick for the applicant -- that would drop the card off the board.
--      'drafted' reverts to undecided. Both revert paths remove the
--      project_members row acceptance created, and neither touches
--      members.status -- see below.
--
--   4. move_draft_pick(pick, project) / add_draft_pick(period, project,
--      application): the pick-level operations, both able to write into an
--      already-submitted round-project via the override in (1a).
--
-- members.status is deliberately NOT reverted when an acceptance is undone:
--
--   * 0065 already establishes the rule in writing -- its sync triggers only
--     ever promote to 'active' and never demote; demotion is the admin's
--     explicit call via set_member_status (0042). Demoting here would be the
--     first thing in the schema to break that.
--   * There is nothing to revert *to*. 0042's backfill documents that it could
--     not distinguish a rolled-off member from a never-member.
--   * It would be wrong for returning members: someone active because of a
--     prior period would be de-membered org-wide, stripped from every project
--     portal's managed roster (0013), and flipped on is_returning_member()
--     (0042) mid-review.
--   * Deleting the project_members row is safe on its own: 0065's
--     project_members trigger fires on INSERT/UPDATE only, never on DELETE.
--
-- Interaction with complete_draft (0074/0083) -- verified, nothing breaks: it
-- walks picks under submitted rounds where applications.status = 'submitted'.
-- A card left on Rejected keeps its pick but is skipped by that filter; a card
-- on Accepted is already status='accepted' and skipped; a card reverted to
-- Drafted is back to 'submitted' and will be placed, which is the point. No
-- function here writes draft_state or draft_round_projects.submitted_at.

-- 1. draft_picks_guard: narrow override + rejected slots + period match -------

create or replace function public.draft_picks_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick_count int;
  v_submitted  timestamptz;
  v_period_id  uuid;
  v_current    int;
  v_status     text;
  v_app_period uuid;
  v_override   boolean := false;
begin
  -- Two steps rather than one AND: the role check must not run on the normal
  -- (no-GUC) path, which is every PM stage and every applicant-facing write.
  if coalesce(current_setting('app.draft_admin_override', true), 'off') = 'on' then
    v_override := public.can_review_all_projects();
  end if;

  select rp.pick_count, rp.submitted_at, dr.period_id
    into v_pick_count, v_submitted, v_period_id
  from public.draft_round_projects rp
  join public.draft_rounds dr on dr.id = rp.round_id
  where rp.id = new.round_project_id;

  if v_submitted is not null and not v_override then
    raise exception 'This round has already been submitted.';
  end if;

  select a.status, a.period_id into v_status, v_app_period
  from public.applications a
  where a.id = new.application_id;

  if v_status is null or v_status not in ('submitted', 'accepted') then
    raise exception 'Rejected applicants cannot be drafted.';
  end if;

  if v_app_period is not null and v_app_period is distinct from v_period_id then
    raise exception 'That applicant did not apply in this application period.';
  end if;

  -- Already confirmed by another project in this period (0088).
  if exists (
    select 1
    from public.draft_picks dp
    join public.draft_round_projects rp on rp.id = dp.round_project_id
    join public.draft_rounds dr on dr.id = rp.round_id
    where dp.application_id = new.application_id
      and dr.period_id = v_period_id
      and rp.submitted_at is not null
      and rp.id <> new.round_project_id
  ) then
    raise exception 'This applicant has already been claimed.';
  end if;

  -- Rejected picks stay on the cross-project board but can never become a
  -- placement, so they do not hold a slot -- 0083's "rejecting frees the slot",
  -- preserved now that rejecting no longer deletes.
  select count(*) into v_current
  from public.draft_picks dp
  join public.applications a on a.id = dp.application_id
  where dp.round_project_id = new.round_project_id
    and a.status <> 'rejected';

  if v_current >= v_pick_count and not v_override then
    raise exception 'The draft window is full for this round.';
  end if;

  return new;
end;
$$;

-- 2. Destination selection ----------------------------------------------------
-- Deliberately not granted to a client role: it mutates pick_count. Postgres
-- grants EXECUTE to PUBLIC by default, so the revoke below is load-bearing.

create or replace function public.draft_destination_round_project(
  p_period_id        uuid,
  p_project_id       uuid,
  p_prefer_submitted boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rp_id      uuid;
  v_pick_count int;
  v_picked     int;
begin
  select rp.id, rp.pick_count, c.n
    into v_rp_id, v_pick_count, v_picked
  from public.draft_round_projects rp
  join public.draft_rounds dr on dr.id = rp.round_id
  cross join lateral (
    select count(*)::int as n
    from public.draft_picks dp
    where dp.round_project_id = rp.id
  ) c
  where dr.period_id = p_period_id
    and rp.project_id = p_project_id
  order by
    -- 1. Keep the pick's confirmed-ness: a move never demotes Confirmed -> Staged.
    ((rp.submitted_at is not null) = coalesce(p_prefer_submitted, false)) desc,
    -- 2. Prefer a slot that already exists over inflating one.
    (c.n < rp.pick_count) desc,
    -- 3. Fill in draft order.
    dr.round_number asc
  limit 1;

  if v_rp_id is null then
    raise exception 'That project is not drafting in this application period.';
  end if;

  -- Nothing had headroom (or the whole project is confirmed): widen the winner
  -- by exactly one. picked + 1, not pick_count + 1, so this is still right if
  -- picks already exceed pick_count.
  if v_picked >= v_pick_count then
    update public.draft_round_projects
    set pick_count = v_picked + 1
    where id = v_rp_id;
  end if;

  return v_rp_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, and Supabase's default
-- privileges additionally grant anon/authenticated on anything created in
-- public -- so all three have to come off, or this stays PostgREST-callable by
-- any signed-in user despite mutating pick_count.
revoke execute on function
  public.draft_destination_round_project(uuid, uuid, boolean) from public, anon, authenticated;

-- 3. The per-card outcome dropdown --------------------------------------------

create or replace function public.set_draft_outcome(
  p_application_id uuid,
  p_project_id     uuid,
  p_outcome        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applicant uuid;
  v_accepted  uuid;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  if p_outcome is null or p_outcome not in ('drafted', 'accepted', 'rejected') then
    raise exception 'unknown outcome';
  end if;

  select a.applicant_id, a.accepted_project_id
    into v_applicant, v_accepted
  from public.applications a
  where a.id = p_application_id;

  if v_applicant is null then
    raise exception 'application not found';
  end if;

  -- Undo the placement acceptance created, unless the new outcome is
  -- "accepted onto that same project". `not is_pm` is a hard rule: acceptance
  -- only ever inserts is_pm = false rows (0022/0057), so a PM row was never
  -- ours to remove. The 0013 triggers propagate the delete into the project's
  -- portal roster; 0065's activate trigger is INSERT/UPDATE-only and does not
  -- fire here, which is exactly why members.status survives untouched.
  if v_accepted is not null
     and (p_outcome <> 'accepted' or v_accepted is distinct from p_project_id) then
    delete from public.project_members
    where project_id = v_accepted
      and user_id    = v_applicant
      and not is_pm;
  end if;

  if p_outcome = 'accepted' then
    if p_project_id is null then
      raise exception 'a project is required to accept an applicant';
    end if;
    -- One implementation of placement, shared with manual review and
    -- complete_draft.
    perform public.accept_application(p_application_id, p_project_id);

  elsif p_outcome = 'rejected' then
    -- NOT reject_application() (0083), which also deletes every draft_pick for
    -- this applicant. Keeping the pick is safe: draft_picks_guard still refuses
    -- to create NEW picks for a rejected applicant, and complete_draft's
    -- `a.status = 'submitted'` filter means a kept pick can never turn into a
    -- placement on its own.
    update public.applications
    set status              = 'rejected',
        accepted_project_id = null,
        reviewed_by         = auth.uid(),
        reviewed_at         = now()
    where id = p_application_id;

  else
    -- 'drafted' -- back to undecided. Picks are untouched, so the card stays
    -- exactly where it is on the board, just without a badge.
    update public.applications
    set status              = 'submitted',
        accepted_project_id = null,
        reviewed_by         = null,
        reviewed_at         = null
    where id = p_application_id;
  end if;
end;
$$;

grant execute on function public.set_draft_outcome(uuid, uuid, text) to authenticated;
-- Supabase's default privileges also grant anon; this is exec-only, so take
-- it back off the unauthenticated surface (it would raise 'not authorized'
-- either way, but there is no reason to expose the endpoint).
revoke execute on function public.set_draft_outcome(uuid, uuid, text) from anon;

-- 4. Move a pick to another project ------------------------------------------

create or replace function public.move_draft_pick(p_pick_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_id         uuid;
  v_period_id      uuid;
  v_src_project    uuid;
  v_src_submitted  timestamptz;
  v_dest_rp        uuid;
  v_dest_submitted timestamptz;
  v_pick_id        uuid;
  v_applicant      uuid;
  v_accepted       uuid;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  select dp.application_id, dr.period_id, rp.project_id, rp.submitted_at
    into v_app_id, v_period_id, v_src_project, v_src_submitted
  from public.draft_picks dp
  join public.draft_round_projects rp on rp.id = dp.round_project_id
  join public.draft_rounds dr        on dr.id = rp.round_id
  where dp.id = p_pick_id;

  if v_app_id is null then
    raise exception 'pick not found';
  end if;

  if v_src_project = p_project_id then
    raise exception 'That applicant is already on this project.';
  end if;

  v_dest_rp := public.draft_destination_round_project(
    v_period_id, p_project_id, v_src_submitted is not null
  );

  -- Delete then insert. See the header: the insert re-runs draft_picks_guard,
  -- so status / period / already-claimed are enforced by the same single copy
  -- of the rules a PM's stage goes through -- and deleting first is what makes
  -- confirmed -> confirmed legal without weakening the claimed check. Any
  -- raise from the guard aborts the whole function, restoring the deleted row.
  delete from public.draft_picks where id = p_pick_id;

  perform set_config('app.draft_admin_override', 'on', true);
  insert into public.draft_picks (round_project_id, application_id)
  values (v_dest_rp, v_app_id)
  on conflict (round_project_id, application_id) do nothing;  -- merge, don't fail
  perform set_config('app.draft_admin_override', 'off', true);

  select id into v_pick_id
  from public.draft_picks
  where round_project_id = v_dest_rp and application_id = v_app_id;

  select submitted_at into v_dest_submitted
  from public.draft_round_projects where id = v_dest_rp;

  -- Landing in a confirmed round-project claims the applicant, so drop them
  -- from every other project's still-open window, same as 0088 does on submit.
  if v_dest_submitted is not null then
    perform public.purge_claimed_from_other_windows(v_dest_rp);
  end if;

  -- Re-point a real placement, if there is one. Same is_pm rule as
  -- set_draft_outcome; accept_application() then re-inserts on the destination
  -- and re-activates the member (a no-op when they are already active).
  select a.applicant_id, a.accepted_project_id
    into v_applicant, v_accepted
  from public.applications a where a.id = v_app_id;

  if v_accepted is not null and v_accepted is distinct from p_project_id then
    delete from public.project_members
    where project_id = v_accepted
      and user_id    = v_applicant
      and not is_pm;

    perform public.accept_application(v_app_id, p_project_id);
  end if;

  return jsonb_build_object(
    'pick_id',          v_pick_id,
    'round_project_id', v_dest_rp,
    'project_id',       p_project_id,
    'submitted',        v_dest_submitted is not null
  );
end;
$$;

grant execute on function public.move_draft_pick(uuid, uuid) to authenticated;
-- Supabase's default privileges also grant anon; this is exec-only, so take
-- it back off the unauthenticated surface (it would raise 'not authorized'
-- either way, but there is no reason to expose the endpoint).
revoke execute on function public.move_draft_pick(uuid, uuid) from anon;

-- 5. Add an applicant to a project from the "+" card ---------------------------

create or replace function public.add_draft_pick(
  p_period_id      uuid,
  p_project_id     uuid,
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rp_id     uuid;
  v_pick_id   uuid;
  v_submitted timestamptz;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  -- A manual add is a new, tentative decision, so prefer a still-open window;
  -- falls back to a confirmed round-project (widening pick_count) when every
  -- one of this project's rounds is already submitted.
  v_rp_id := public.draft_destination_round_project(p_period_id, p_project_id, false);

  perform set_config('app.draft_admin_override', 'on', true);
  insert into public.draft_picks (round_project_id, application_id)
  values (v_rp_id, p_application_id)
  on conflict (round_project_id, application_id) do nothing;
  perform set_config('app.draft_admin_override', 'off', true);

  select id into v_pick_id
  from public.draft_picks
  where round_project_id = v_rp_id and application_id = p_application_id;

  select submitted_at into v_submitted
  from public.draft_round_projects where id = v_rp_id;

  if v_submitted is not null then
    perform public.purge_claimed_from_other_windows(v_rp_id);
  end if;

  return jsonb_build_object(
    'pick_id',          v_pick_id,
    'round_project_id', v_rp_id,
    'project_id',       p_project_id,
    'submitted',        v_submitted is not null
  );
end;
$$;

grant execute on function public.add_draft_pick(uuid, uuid, uuid) to authenticated;
-- Supabase's default privileges also grant anon; this is exec-only, so take
-- it back off the unauthenticated surface (it would raise 'not authorized'
-- either way, but there is no reason to expose the endpoint).
revoke execute on function public.add_draft_pick(uuid, uuid, uuid) from anon;

notify pgrst, 'reload schema';

-- Rollback ---------------------------------------------------------------------
-- Drop set_draft_outcome / move_draft_pick / add_draft_pick /
-- draft_destination_round_project and re-run draft_picks_guard() from
-- 0088_draft_claimed_cross_project.sql (lines 32-87). No policies, tables or
-- columns were changed, so nothing else needs undoing. Any draft_picks row
-- sitting under a submitted round-project stays valid -- 0088's guard simply
-- would not have created it.
