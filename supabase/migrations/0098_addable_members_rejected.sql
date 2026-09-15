-- The exec "+" picker hid rejected applicants entirely, which read as the search
-- being broken: someone with an account, a name and an application simply was
-- not there, with nothing on screen to say why.
--
-- 0096 excluded them on purpose -- draft_picks_guard raises 'Rejected applicants
-- cannot be drafted.', so offering one would be offering a click that fails.
-- That reasoning was right about the guard and wrong about the product: an exec
-- reaching for someone they rejected is reversing that call deliberately, which
-- is a decision the board already supports everywhere else (set_draft_outcome's
-- 'drafted' reverts an outcome to undecided). The picker is now the same
-- gesture, from the other direction.
--
-- Two changes:
--
--   1. search_addable_members returns rejected accounts, and reports WHY each
--      row is out of the pool instead of answering the narrower "do they have a
--      draft?". The boolean has_draft becomes app_status -- null (no
--      application at all), 'draft' (started, never submitted), or 'rejected' --
--      so the picker can label each row honestly rather than filing everyone
--      under one heading. Return type changes, hence drop + create.
--
--      Still excluded: 'submitted' and 'accepted'. Those people are the picker's
--      other list, and showing them twice would be the only real confusion here.
--
--   2. add_member_to_draft reverts the rejection before placing the pick, so the
--      insert meets draft_picks_guard as an ordinary submitted application. The
--      revert mirrors set_draft_outcome(..., 'drafted') exactly: status back to
--      'submitted', and the review fields cleared, because a reverted rejection
--      is undecided rather than re-decided.
--
-- exec_added is deliberately NOT set on this path. A rejected applicant wrote a
-- real application -- Lucas, the case that surfaced this, has seven ranked
-- projects and essays -- and flagging it would both mislabel his card ("No
-- application") and quietly drop a genuine submission out of the recruiting
-- analytics 0096 excludes. exec_added means "we invented this row", and here we
-- did not.

drop function if exists public.search_addable_members(uuid, text);

create function public.search_addable_members(
  p_period_id uuid,
  p_query     text
)
returns table (
  user_id    uuid,
  name       text,
  email      text,
  -- Why they are not already in the draft pool: null = never applied,
  -- 'draft' = started and never submitted, 'rejected' = applied and turned down.
  app_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_needle text;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  v_needle := btrim(coalesce(p_query, ''));
  if length(v_needle) < 2 then
    return;
  end if;
  v_needle := '%' || v_needle || '%';

  return query
  select
    m.user_id,
    nullif(btrim(concat_ws(' ', m.preferred_firstname, m.lastname)), '') as name,
    m.email,
    (
      select a.status from applications a
      where a.applicant_id = m.user_id
        and a.period_id = p_period_id
    ) as app_status
  from members m
  where (
      m.preferred_firstname ilike v_needle
      or m.lastname ilike v_needle
      or m.email ilike v_needle
      or concat_ws(' ', m.preferred_firstname, m.lastname) ilike v_needle
    )
    and not exists (
      select 1 from applications a
      where a.applicant_id = m.user_id
        and a.period_id = p_period_id
        and a.status in ('submitted', 'accepted')
    )
  order by coalesce(m.preferred_firstname, ''), coalesce(m.lastname, ''), m.email
  limit 50;
end;
$$;

revoke execute on function public.search_addable_members(uuid, text) from public, anon;
grant  execute on function public.search_addable_members(uuid, text) to authenticated;

create or replace function public.add_member_to_draft(
  p_period_id  uuid,
  p_project_id uuid,
  p_user_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_id  uuid;
  v_status  text;
  v_result  jsonb;
begin
  if not public.can_review_all_projects() then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from public.members where user_id = p_user_id) then
    raise exception 'That account does not exist.';
  end if;

  if not exists (select 1 from public.application_periods where id = p_period_id) then
    raise exception 'application period not found';
  end if;

  select a.id, a.status into v_app_id, v_status
  from public.applications a
  where a.applicant_id = p_user_id
    and a.period_id = p_period_id;

  if v_app_id is null then
    -- Never applied: the row exists only so they can be drafted.
    insert into public.applications (applicant_id, period_id, status, submitted_at, exec_added)
    values (p_user_id, p_period_id, 'submitted', now(), true)
    returning id into v_app_id;

  elsif v_status = 'draft' then
    -- Started and abandoned. Submit what they had rather than discarding it;
    -- still exec_added, because they never chose to submit it.
    update public.applications
    set status       = 'submitted',
        submitted_at = coalesce(submitted_at, now()),
        exec_added   = true
    where id = v_app_id;

  elsif v_status = 'rejected' then
    -- Un-reject, exactly as set_draft_outcome(..., 'drafted') does. Their own
    -- submission and its timestamp stand untouched, and exec_added stays false:
    -- this application was always real.
    update public.applications
    set status              = 'submitted',
        accepted_project_id = null,
        reviewed_by         = null,
        reviewed_at         = null
    where id = v_app_id;
  end if;

  -- Re-checks can_review_all_projects(); the pick still runs through
  -- draft_picks_guard, which now sees a 'submitted' application either way.
  v_result := public.add_draft_pick(p_period_id, p_project_id, v_app_id);

  return v_result || jsonb_build_object(
    'application_id', v_app_id,
    -- Lets the client say what it actually did, rather than guessing.
    'unrejected',     v_status = 'rejected'
  );
end;
$$;

revoke execute on function public.add_member_to_draft(uuid, uuid, uuid) from public, anon;
grant  execute on function public.add_member_to_draft(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Rollback -------------------------------------------------------------------
-- Re-run section 2 (search_addable_members, dropping first -- the return type
-- differs) and section 3 (add_member_to_draft) of
-- 0096_draft_members_without_application.sql. Applications un-rejected in the
-- meantime stay 'submitted'; the board's own outcome menu is how they would go
-- back to rejected.
