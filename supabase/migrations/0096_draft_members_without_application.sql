-- Let the exec draft board (?project=all on /manager/applications) place people
-- who never submitted a written application -- and carry them all the way to
-- full membership through the existing outcome dropdown.
--
-- The problem: every draft surface is keyed on an application. draft_picks
-- .application_id is NOT NULL with an FK to applications; draft_picks_guard
-- (0088/0091) reads applications.status and applications.period_id; the board,
-- the roster and set_draft_outcome (0091) all address a card by application id.
-- Someone who never applied has no row anywhere in that chain, so there is
-- nothing for the "+" picker to hand add_draft_pick.
--
-- Two ways out. Make application_id nullable and teach the guard, the board,
-- complete_draft, the review modal and the analytics RPCs to cope with a pick
-- that has no application -- a nullable FK threaded through every consumer. Or
-- give the person a real application row that is honestly labelled as one they
-- did not write. This migration takes the second: one new boolean column, and
-- every existing rule keeps working unchanged because the row it sees is a
-- perfectly ordinary submitted application.
--
--   applications.exec_added  -- this row exists because an exec put the person
--                               on the board, not because the applicant
--                               submitted anything.
--
-- What that buys, with no other code touched:
--
--   * draft_picks_guard's status / period / already-claimed checks pass, so the
--     one copy of the drafting rules still governs the insert.
--   * set_draft_outcome(..., 'accepted') -> accept_application (0042) ->
--     project_members + members.status = 'active' + the 0013 portal roster
--     sync. "Drafted, then a full member if they accept" (0092's reading) works
--     for these people exactly as it does for real applicants.
--   * The PM-facing per-project list is unaffected: it joins
--     application_rankings!inner, and these rows have no rankings, so they
--     never appear in anyone's review queue. The review modal already renders
--     "No ranked projects on this application."
--
-- What it costs, and what is paid here: recruiting analytics count rows in
-- `applications`. Left alone, adding twelve people to the board would report
-- twelve more submissions -- and each would land in the invalid list for
-- missing a coffee chat they were never asked to have. Section 4 excludes
-- exec_added rows from all three analytics RPCs, which is the whole of the
-- blast radius: `submitted` there means "an application we received", and this
-- is not one.
--
-- Deliberately NOT done: back-filling any existing row. Every application that
-- exists today was submitted by its applicant, so the default is correct for
-- all of them.

-- 1. The column ---------------------------------------------------------------

alter table public.applications
  add column if not exists exec_added boolean not null default false;

comment on column public.applications.exec_added is
  'True when an exec created (or force-submitted) this row from the draft board '
  'so someone could be drafted without applying. Excluded from recruiting analytics.';

-- 2. Who the "+" picker may offer ---------------------------------------------
-- Members with no application in play this period. Anyone already submitted or
-- accepted belongs to the normal picker (usePeriodApplicants), and anyone
-- rejected is out of play -- draft_picks_guard would refuse them, so they are
-- not offered rather than offered-then-refused.
--
-- A left-behind DRAFT is included, flagged has_draft: "started it, never
-- submitted" is the most common reason someone is missing from the board, and
-- add_member_to_draft below submits what they had rather than discarding it.
--
-- SECURITY DEFINER because the picker must see members who are strangers to
-- the caller, and it is exec-gated for the same reason. Search-only (no
-- unfiltered listing): p_query under 2 characters returns nothing, so this
-- cannot be used to page out the whole member table.

create or replace function public.search_addable_members(
  p_period_id uuid,
  p_query     text
)
returns table (
  user_id   uuid,
  name      text,
  email     text,
  has_draft boolean
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
    exists (
      select 1 from applications a
      where a.applicant_id = m.user_id
        and a.period_id = p_period_id
        and a.status = 'draft'
    ) as has_draft
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
        and a.status in ('submitted', 'accepted', 'rejected')
    )
  order by coalesce(m.preferred_firstname, ''), coalesce(m.lastname, ''), m.email
  limit 50;
end;
$$;

-- Exec-only, so the endpoint comes off the unauthenticated surface. It has to
-- be revoked from PUBLIC, not just anon: Postgres's default ACL on a new
-- function is a PUBLIC grant, and `revoke ... from anon` leaves that standing --
-- has_function_privilege('anon', ...) still returns true. Every RPC written
-- before this one had that bug; 0097 sweeps them.
revoke execute on function public.search_addable_members(uuid, text) from public, anon;
grant execute on function public.search_addable_members(uuid, text) to authenticated;

-- 3. Add one of them to a project ---------------------------------------------
-- Makes the application row, then hands off to add_draft_pick (0091) rather
-- than repeating its body: destination selection, the admin override around the
-- insert, and purge_claimed_from_other_windows all stay in one place, and the
-- pick still goes in through draft_picks_guard.
--
-- Three cases for the application row, and only the first two write:
--
--   no row      insert one, status 'submitted', exec_added.
--   'draft'     submit what they had. Their own partial answers are kept -- an
--               exec adding someone mid-draft means "include this person", not
--               "erase what they wrote" -- and the row is marked exec_added
--               because it still is not a submission they chose to make.
--   otherwise   left completely alone. 'submitted'/'accepted' means they applied
--               after the picker's list was built, and this is then an ordinary
--               add; 'rejected' falls through to draft_picks_guard, which
--               raises 'Rejected applicants cannot be drafted.' -- one copy of
--               that rule, and no path here can quietly un-reject someone.
--
-- submitted_at is now(), never backdated: it is the moment the exec added them,
-- and the board's own late badge reads it. These rows are out of the analytics
-- that would otherwise punish a late timestamp.

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
    insert into public.applications (applicant_id, period_id, status, submitted_at, exec_added)
    values (p_user_id, p_period_id, 'submitted', now(), true)
    returning id into v_app_id;

  elsif v_status = 'draft' then
    update public.applications
    set status       = 'submitted',
        submitted_at = coalesce(submitted_at, now()),
        exec_added   = true
    where id = v_app_id;
  end if;

  -- Re-checks can_review_all_projects(), so the authorization above is not the
  -- only gate; the pick itself still runs through draft_picks_guard.
  v_result := public.add_draft_pick(p_period_id, p_project_id, v_app_id);

  return v_result || jsonb_build_object('application_id', v_app_id);
end;
$$;

-- PUBLIC as well as anon -- see search_addable_members above.
revoke execute on function public.add_member_to_draft(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_member_to_draft(uuid, uuid, uuid) to authenticated;

-- 4. Keep exec-added rows out of recruiting analytics -------------------------
-- Each of the three is re-emitted verbatim from its current definition (0084
-- for the first two, 0053/0084 for the third) with one predicate added. The
-- filter goes in the source CTE, so every count downstream of it -- submitted,
-- accepted, the coffee/info breakdowns, both_valid, the invalid list -- drops
-- these rows together and the totals still reconcile.

create or replace function public.application_analytics()
returns table (
  period_id         uuid,
  period_name       text,
  created_at        timestamptz,
  empty_drafts      integer,
  unfinished_drafts integer,
  submitted         integer,
  accepted          integer,
  rejected          integer,
  coffee_completed  integer,
  coffee_booked     integer,
  coffee_returning  integer,
  coffee_nothing    integer,
  info_attended     integer,
  info_returning    integer,
  info_nothing      integer,
  both_valid        integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  return query
  with app as (
    select
      a.period_id,
      a.status,
      (a.status in ('submitted','accepted','rejected')) as sub,
      exists (
        select 1
        from application_rankings r
        where r.application_id = a.id
          and (
            nullif(btrim(r.essay), '') is not null
            or exists (select 1 from application_answers ans where ans.ranking_id = r.id)
          )
      ) as has_content,
      exists (select 1 from coffee_chats c where c.applicant_id = a.applicant_id and c.complete) as did_complete,
      exists (select 1 from coffee_chats c where c.applicant_id = a.applicant_id) as has_chat,
      exists (
        select 1 from members m
        where m.user_id = a.applicant_id and m.status in ('active', 'inactive')
      ) as is_ret,
      exists (
        select 1 from infosesh_attendance i
        where i.applicant_id = a.applicant_id or i.member_id = a.applicant_id
      ) as did_att,
      public.is_recruiting_valid(a.applicant_id, a.submitted_at, per.ends_at) as is_valid
    from applications a
    left join application_periods per on per.id = a.period_id
    -- 0096: rows an exec made so someone could be drafted are not submissions.
    where not a.exec_added
  ),
  f as (
    select
      app.period_id,
      app.status,
      app.sub,
      app.has_content,
      app.did_complete,
      app.is_ret,
      app.did_att,
      app.is_valid,
      case
        when did_complete then 'completed'
        when has_chat then 'booked'
        when is_ret then 'returning'
        else 'nothing'
      end as coffee_cat,
      case
        when did_att then 'attended'
        when is_ret then 'returning'
        else 'nothing'
      end as info_cat
    from app
  )
  select
    p.id,
    p.name,
    p.created_at,
    count(*) filter (where f.status = 'draft' and not f.has_content)::int,
    count(*) filter (where f.status = 'draft' and f.has_content)::int,
    count(*) filter (where f.status = 'submitted')::int,
    count(*) filter (where f.status = 'accepted')::int,
    count(*) filter (where f.status = 'rejected')::int,
    count(*) filter (where f.sub and f.coffee_cat = 'completed')::int,
    count(*) filter (where f.sub and f.coffee_cat = 'booked')::int,
    count(*) filter (where f.sub and f.coffee_cat = 'returning')::int,
    count(*) filter (where f.sub and f.coffee_cat = 'nothing')::int,
    count(*) filter (where f.sub and f.info_cat = 'attended')::int,
    count(*) filter (where f.sub and f.info_cat = 'returning')::int,
    count(*) filter (where f.sub and f.info_cat = 'nothing')::int,
    count(*) filter (
      where f.status in ('submitted', 'accepted') and f.is_valid
    )::int
  from application_periods p
  left join f on f.period_id = p.id
  group by p.id, p.name, p.created_at
  order by p.created_at desc;
end;
$$;

create or replace function public.application_analytics_invalid(p_period_id uuid)
returns table (
  applicant_id       uuid,
  preferred_firstname text,
  lastname           text,
  is_returning       boolean,
  did_complete       boolean,
  has_chat           boolean,
  did_att            boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  return query
  with flagged as (
    select
      a.applicant_id as aid,
      m.preferred_firstname as fname,
      m.lastname as lname,
      exists (
        select 1 from members r
        where r.user_id = a.applicant_id and r.status in ('active', 'inactive')
      ) as ret,
      exists (
        select 1 from coffee_chats c
        where c.applicant_id = a.applicant_id and c.complete
      ) as completed,
      exists (
        select 1 from coffee_chats c
        where c.applicant_id = a.applicant_id
      ) as booked,
      exists (
        select 1 from infosesh_attendance i
        where i.applicant_id = a.applicant_id or i.member_id = a.applicant_id
      ) as attended,
      public.is_recruiting_valid(a.applicant_id, a.submitted_at, per.ends_at) as is_valid
    from applications a
    left join members m on m.user_id = a.applicant_id
    left join application_periods per on per.id = a.period_id
    where a.period_id = p_period_id
      and a.status in ('submitted', 'accepted')
      -- 0096: excluded from the submitted count, so excluded from its shortfall.
      and not a.exec_added
  )
  select
    flagged.aid,
    flagged.fname,
    flagged.lname,
    flagged.ret,
    flagged.completed,
    flagged.booked,
    flagged.attended
  from flagged
  where not flagged.is_valid
  order by
    coalesce(flagged.fname, ''),
    coalesce(flagged.lname, ''),
    flagged.aid;
end;
$$;

create or replace function public.application_period_stats(p_period_id uuid)
returns table (
  empty_drafts         integer,
  unfinished_drafts    integer,
  submitted            integer,
  accepted             integer,
  rejected             integer,
  coffee_chat_valid    integer,
  infosession_attended integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  return query
  with app as (
    select
      a.status,
      exists (
        select 1
        from application_rankings r
        where r.application_id = a.id
          and (
            nullif(btrim(r.essay), '') is not null
            or exists (select 1 from application_answers ans where ans.ranking_id = r.id)
          )
      ) as has_content,
      (
        -- Booked or completed a coffee chat (any row under their applicant_id),
        -- or a returning member who's exempt from the requirement.
        exists (select 1 from coffee_chats c where c.applicant_id = a.applicant_id)
        or exists (
          select 1 from members m
          where m.user_id = a.applicant_id
            and m.status in ('active', 'inactive')
        )
      ) as coffee_valid,
      exists (
        select 1
        from infosesh_attendance i
        where i.applicant_id = a.applicant_id
           or i.member_id = a.applicant_id
      ) as did_info
    from applications a
    where a.period_id = p_period_id
      -- 0096: see application_analytics.
      and not a.exec_added
  )
  select
    count(*) filter (where status = 'draft' and not has_content)::int,
    count(*) filter (where status = 'draft' and has_content)::int,
    count(*) filter (where status = 'submitted')::int,
    count(*) filter (where status = 'accepted')::int,
    count(*) filter (where status = 'rejected')::int,
    count(*) filter (where status in ('submitted','accepted','rejected') and coffee_valid)::int,
    count(*) filter (where status in ('submitted','accepted','rejected') and did_info)::int
  from app;
end;
$$;

notify pgrst, 'reload schema';

-- Rollback ---------------------------------------------------------------------
-- 1. drop function public.add_member_to_draft(uuid, uuid, uuid);
--    drop function public.search_addable_members(uuid, text);
-- 2. Re-run application_analytics / application_analytics_invalid from
--    0084_analytics_valid_shared.sql and application_period_stats from
--    0053_application_period_stats.sql to drop the exec_added filters.
-- 3. alter table public.applications drop column exec_added;  -- see below
--
-- Step 3 is destructive in one direction only: any application row created by
-- this feature stays behind as an ordinary submitted application with no
-- rankings, and will then be counted as a submission by the analytics again.
-- Delete those rows first (their draft_picks cascade) if that matters:
--   delete from public.applications where exec_added;
