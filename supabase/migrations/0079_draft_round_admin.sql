-- Lets an exec who can review all projects flip a single round-project's
-- confirmed/staged state directly, independent of whose turn it is. This is
-- an admin correction tool (send a confirmed round back to staged, or force
-- one confirmed out of turn), distinct from submit_draft_picks (0074), which
-- only PMs use and only when it's actually that project's turn. It only ever
-- touches this one draft_round_projects row's submitted_at -- no draft_picks
-- rows are deleted and draft_state.current_pick_id is left untouched, since
-- PicksSoFar/PicksThisRound already derive confirmed/staged purely from
-- submitted_at.
create or replace function public.set_round_submitted(p_round_project_id uuid, p_submitted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  select dr.period_id into v_period_id
  from public.draft_round_projects rp
  join public.draft_rounds dr on dr.id = rp.round_id
  where rp.id = p_round_project_id;

  if v_period_id is null then
    raise exception 'round not found';
  end if;

  if exists (
    select 1 from public.draft_state
    where period_id = v_period_id and completed_at is not null
  ) then
    raise exception 'this draft has already been completed';
  end if;

  update public.draft_round_projects
  set submitted_at = case when p_submitted then now() else null end
  where id = p_round_project_id;
end;
$$;

grant execute on function public.set_round_submitted(uuid, boolean) to authenticated;
