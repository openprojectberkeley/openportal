-- Lets a project's own PM un-submit their round while it's still their turn,
-- so they can keep adding/removing staged picks instead of being locked the
-- instant they hit Submit. Mirrors submit_draft_picks (0074)'s turn check
-- exactly, just inverted: requires the round IS submitted and the draft
-- hasn't advanced past it yet (draft_state.current_pick_id still points at
-- this round_project and the draft isn't completed). Once the exec advances
-- to the next pick, current_pick_id no longer matches and this stops
-- working -- the PM's window to revise closes the same way it opened.
-- Unlike the exec-only set_round_submitted (0079), this is can_review_project()
-- (PM of that project, or a full-access reviewer) and turn-gated, not a
-- blanket admin override.
create or replace function public.unsubmit_draft_picks(p_round_project_id uuid)
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
    where id = p_round_project_id and submitted_at is null
  ) then
    raise exception 'this round has not been submitted';
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
    raise exception 'it is no longer this project''s turn';
  end if;

  update public.draft_round_projects
  set submitted_at = null
  where id = p_round_project_id;
end;
$$;

grant execute on function public.unsubmit_draft_picks(uuid) to authenticated;
