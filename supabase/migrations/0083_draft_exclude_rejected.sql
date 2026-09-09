-- Exclude rejected (dropped) applicants from the draft: they cannot be staged,
-- existing picks are removed when an application is rejected, and complete_draft
-- will not re-accept them. Mirrors the analytics eligibility set from 0080
-- (status in submitted/accepted).

-- 1. Guard: block inserting rejected (or missing) applications into draft_picks
create or replace function public.draft_picks_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick_count int;
  v_submitted  timestamptz;
  v_current    int;
  v_status     text;
begin
  select rp.pick_count, rp.submitted_at
  into v_pick_count, v_submitted
  from public.draft_round_projects rp
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

  select count(*) into v_current
  from public.draft_picks
  where round_project_id = new.round_project_id;

  if v_current >= v_pick_count then
    raise exception 'The draft window is full for this round.';
  end if;

  return new;
end;
$$;

-- 2. On reject: clear any staged/confirmed draft picks so the slot frees up
create or replace function public.reject_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.can_review_all_projects()
    or exists (
      select 1 from public.application_rankings r
      where r.application_id = p_application_id
        and r.ranked
        and public.can_review_project(r.project_id)
    )
  ) then
    raise exception 'not authorized';
  end if;

  update public.applications
  set status = 'rejected',
      accepted_project_id = null,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_application_id;

  if not found then
    raise exception 'application not found';
  end if;

  delete from public.draft_picks
  where application_id = p_application_id;
end;
$$;

grant execute on function public.reject_application(uuid) to authenticated;

-- 3. complete_draft: only accept still-submitted picks (skip rejected;
--    leave already-accepted alone)
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
    join public.applications a on a.id = dp.application_id
    where dr.period_id = p_period_id
      and rp.submitted_at is not null
      and a.status = 'submitted'
  loop
    perform public.accept_application(v_pick.application_id, v_pick.project_id);
  end loop;

  update public.draft_state
  set completed_at = now()
  where period_id = p_period_id;
end;
$$;

grant execute on function public.complete_draft(uuid) to authenticated;

-- 4. One-time cleanup of any existing rejected picks
delete from public.draft_picks dp
using public.applications a
where a.id = dp.application_id and a.status = 'rejected';
