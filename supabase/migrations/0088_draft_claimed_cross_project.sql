-- Cross-project "claimed" (confirmed) draft picks: board/exec can see who
-- another project has already submitted, PMs cannot stage someone already
-- claimed, and confirming a round purges that applicant from other projects'
-- unsubmitted draft windows.
--
-- "Confirmed" = draft_picks under a draft_round_projects row with
-- submitted_at IS NOT NULL. Staging (submitted_at null) stays private to the
-- owning project's reviewers.

-- 1. Board/exec read of confirmed picks only ---------------------------------
-- Additive with draft_picks_select (0072): own-project reviewers still see
-- staged + confirmed for projects they can_review; everyone board/exec can
-- additionally see confirmed picks across projects (not staged).

drop policy if exists "draft_picks_select_confirmed_board" on public.draft_picks;
create policy "draft_picks_select_confirmed_board"
on public.draft_picks
for select
to authenticated
using (
  public.is_board_or_exec()
  and exists (
    select 1
    from public.draft_round_projects rp
    where rp.id = draft_picks.round_project_id
      and rp.submitted_at is not null
  )
);

-- 2. Guard: block staging an applicant already claimed in this period ---------

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
begin
  select rp.pick_count, rp.submitted_at, dr.period_id
    into v_pick_count, v_submitted, v_period_id
  from public.draft_round_projects rp
  join public.draft_rounds dr on dr.id = rp.round_id
  where rp.id = new.round_project_id;

  if v_submitted is not null then
    raise exception 'This round has already been submitted.';
  end if;

  select a.status into v_status
  from public.applications a
  where a.id = new.application_id;

  if v_status is null or v_status not in ('submitted', 'accepted') then
    raise exception 'Rejected applicants cannot be drafted.';
  end if;

  -- Already confirmed by another project in this period.
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

  select count(*) into v_current
  from public.draft_picks
  where round_project_id = new.round_project_id;

  if v_current >= v_pick_count then
    raise exception 'The draft window is full for this round.';
  end if;

  return new;
end;
$$;

-- Shared cleanup: remove claimed applications from other projects' unsubmitted
-- draft windows in the same period. Used by submit_draft_picks and by
-- set_round_submitted when confirming.
create or replace function public.purge_claimed_from_other_windows(p_round_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  select dr.period_id into v_period_id
  from public.draft_round_projects rp
  join public.draft_rounds dr on dr.id = rp.round_id
  where rp.id = p_round_project_id;

  if v_period_id is null then
    return;
  end if;

  delete from public.draft_picks dp
  using public.draft_round_projects other_rp
  join public.draft_rounds other_dr on other_dr.id = other_rp.round_id
  where dp.round_project_id = other_rp.id
    and other_dr.period_id = v_period_id
    and other_rp.id <> p_round_project_id
    and other_rp.submitted_at is null
    and dp.application_id in (
      select application_id
      from public.draft_picks
      where round_project_id = p_round_project_id
    );
end;
$$;

-- 3. submit_draft_picks: lock round, then purge from other windows ------------

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

  -- Refuse submit if any pick is already claimed elsewhere (race with another
  -- project's confirm). Prefer a clear error over silent double-confirm.
  if exists (
    select 1
    from public.draft_picks mine
    join public.draft_round_projects my_rp on my_rp.id = mine.round_project_id
    join public.draft_rounds my_dr on my_dr.id = my_rp.round_id
    join public.draft_picks other on other.application_id = mine.application_id
    join public.draft_round_projects other_rp on other_rp.id = other.round_project_id
    join public.draft_rounds other_dr on other_dr.id = other_rp.round_id
    where mine.round_project_id = p_round_project_id
      and other_rp.id <> p_round_project_id
      and other_dr.period_id = my_dr.period_id
      and other_rp.submitted_at is not null
  ) then
    raise exception 'This applicant has already been claimed.';
  end if;

  update public.draft_round_projects
  set submitted_at = now()
  where id = p_round_project_id;

  perform public.purge_claimed_from_other_windows(p_round_project_id);
end;
$$;

grant execute on function public.submit_draft_picks(uuid) to authenticated;

-- 4. set_round_submitted: same purge when an exec force-confirms --------------

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

  if p_submitted then
    perform public.purge_claimed_from_other_windows(p_round_project_id);
  end if;
end;
$$;

grant execute on function public.set_round_submitted(uuid, boolean) to authenticated;
