-- Defers actually placing drafted applicants onto their projects from
-- "Submit" (per round, per project) to a separate, explicit "Complete
-- draft" action a VP Tech/President/VP Projects takes once for the whole
-- period. Previously submit_draft_picks() called accept_application()
-- immediately, so a "Confirmed" pick was already a real project_members
-- row -- meaning Reset (which only cleared draft_state.current_pick_id)
-- could never actually undo it. Now:
--
--   - submit_draft_picks(p_round_project_id): unchanged authorization/turn
--     checks, but no longer places anyone -- it only marks the round
--     submitted (still gated on the draft not already being completed, via
--     the same turn check now also requiring draft_state.completed_at is
--     null). A "Confirmed" pick from here on is real only in the sense that
--     it's locked into that round; the applicant is still just 'submitted'
--     until complete_draft() runs.
--   - draft_state.completed_at: null while the draft is in progress; set
--     once complete_draft() has run. A completed draft can't be reset or
--     submitted into again.
--   - complete_draft(p_period_id): SECURITY DEFINER, can_review_all_projects()
--     only. Walks every draft_picks row under an already-submitted round in
--     this period and calls accept_application() for each (same placement/
--     authorization as manual review and as the old submit_draft_picks),
--     then stamps completed_at. Idempotency guard: raises if already
--     completed, so it can't double-run.
--   - reset_draft(p_period_id): SECURITY DEFINER, can_review_all_projects()
--     only. Deletes every draft_picks row for the period's rounds (both
--     staged and confirmed -- a full reset starts over) and un-submits
--     every round, then clears draft_state.current_pick_id. Since accept_
--     application is now deferred, nothing needs to be undone on
--     applications/project_members -- a "confirmed" pick was never a real
--     placement, so resetting genuinely just sends everyone back to being
--     plain applicants. Blocked once completed_at is set, since actual
--     placements from complete_draft() are not something this should try
--     to auto-undo. Replaces the plain client-side draft_state upsert the
--     "Reset" button used to do directly -- that alone can't touch
--     draft_picks under an already-submitted round (0072's
--     draft_picks_delete policy requires submitted_at is null), which is
--     exactly why this needs to be a privileged RPC.

alter table public.draft_state add column if not exists completed_at timestamptz;

create or replace function public.submit_draft_picks(p_round_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id
  from public.draft_round_projects
  where id = p_round_project_id;

  if v_project_id is null then
    raise exception 'round not found';
  end if;

  if not public.can_review_project(v_project_id) then
    raise exception 'not authorized';
  end if;

  if exists (
    select 1 from public.draft_round_projects
    where id = p_round_project_id and submitted_at is not null
  ) then
    raise exception 'this round has already been submitted';
  end if;

  if not exists (
    select 1
    from public.draft_round_projects rp
    join public.draft_rounds dr on dr.id = rp.round_id
    join public.draft_state ds on ds.period_id = dr.period_id
    where rp.id = p_round_project_id
      and ds.current_pick_id = p_round_project_id
      and ds.completed_at is null
  ) then
    raise exception 'it is not this project''s turn to pick';
  end if;

  -- Locks the round in as "confirmed" (draft_picks under it now read as
  -- confirmed rather than staged) but does not place anyone yet -- that
  -- only happens once complete_draft() runs.
  update public.draft_round_projects
  set submitted_at = now()
  where id = p_round_project_id;
end;
$$;

grant execute on function public.submit_draft_picks(uuid) to authenticated;

create or replace function public.complete_draft(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick record;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from public.draft_state where period_id = p_period_id) then
    raise exception 'this draft has not started yet';
  end if;

  if exists (
    select 1 from public.draft_state
    where period_id = p_period_id and completed_at is not null
  ) then
    raise exception 'this draft has already been completed';
  end if;

  for v_pick in
    select dp.application_id, rp.project_id
    from public.draft_picks dp
    join public.draft_round_projects rp on rp.id = dp.round_project_id
    join public.draft_rounds dr on dr.id = rp.round_id
    where dr.period_id = p_period_id
      and rp.submitted_at is not null
  loop
    perform public.accept_application(v_pick.application_id, v_pick.project_id);
  end loop;

  update public.draft_state
  set completed_at = now()
  where period_id = p_period_id;
end;
$$;

grant execute on function public.complete_draft(uuid) to authenticated;

create or replace function public.reset_draft(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  if exists (
    select 1 from public.draft_state
    where period_id = p_period_id and completed_at is not null
  ) then
    raise exception 'this draft has already been completed and can no longer be reset';
  end if;

  delete from public.draft_picks
  where round_project_id in (
    select rp.id
    from public.draft_round_projects rp
    join public.draft_rounds dr on dr.id = rp.round_id
    where dr.period_id = p_period_id
  );

  update public.draft_round_projects
  set submitted_at = null
  where round_id in (select id from public.draft_rounds where period_id = p_period_id);

  insert into public.draft_state (period_id, current_pick_id, updated_at)
  values (p_period_id, null, now())
  on conflict (period_id) do update set current_pick_id = null, updated_at = now();
end;
$$;

grant execute on function public.reset_draft(uuid) to authenticated;
