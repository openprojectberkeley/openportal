-- Treat first-timers who submitted 3+ days after the period deadline as
-- recruiting-invalid. Board/exec and returning stay auto-valid. Matches the
-- client `isSeverelyLate` / `isRecruitingValid` helpers (daysLate >= 3, which
-- is submitted_at > ends_at + 2 days under ceil-day rounding). Rejected
-- applicants stay excluded from both_valid / the invalid list (0080).

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
security definer
set search_path = public
stable
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
      exists (
        select 1
        from members_roles mr
        join roles rr on rr.id = mr.role_id
        where mr.user_id = a.applicant_id and rr.access_level in ('board', 'exec')
      ) as is_be,
      (
        a.submitted_at is not null
        and p.ends_at is not null
        and a.submitted_at > p.ends_at + interval '2 days'
      ) as is_severely_late
    from applications a
    left join application_periods p on p.id = a.period_id
  ),
  f as (
    -- Qualify period_id: the RETURNS TABLE OUT column of the same name is in
    -- scope here, so an unqualified reference is ambiguous.
    select
      app.period_id,
      app.status,
      app.sub,
      app.has_content,
      app.did_complete,
      app.is_ret,
      app.did_att,
      app.is_be,
      app.is_severely_late,
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
    -- Valid measure excludes rejected (dropped) applicants.
    count(*) filter (
      where f.status in ('submitted', 'accepted')
        and (
          f.is_be
          or f.is_ret
          or (f.did_complete and f.did_att and not f.is_severely_late)
        )
    )::int
  from application_periods p
  left join f on f.period_id = p.id
  group by p.id, p.name, p.created_at
  order by p.created_at desc;
end;
$$;

revoke all on function public.application_analytics() from public;
grant execute on function public.application_analytics() to authenticated;


-- Per-person "invalid" list — rejected excluded; adds is_severely_late for UI.
drop function if exists public.application_analytics_invalid(uuid);

create function public.application_analytics_invalid(p_period_id uuid)
returns table (
  applicant_id        uuid,
  preferred_firstname text,
  lastname            text,
  is_returning        boolean,
  did_complete        boolean,
  has_chat            boolean,
  did_att             boolean,
  is_severely_late    boolean
)
language plpgsql
security definer
set search_path = public
stable
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
      exists (
        select 1
        from members_roles mr
        join roles rr on rr.id = mr.role_id
        where mr.user_id = a.applicant_id and rr.access_level in ('board', 'exec')
      ) as board_exec,
      (
        a.submitted_at is not null
        and per.ends_at is not null
        and a.submitted_at > per.ends_at + interval '2 days'
      ) as severely_late
    from applications a
    left join members m on m.user_id = a.applicant_id
    left join application_periods per on per.id = a.period_id
    where a.period_id = p_period_id
      and a.status in ('submitted', 'accepted')
  )
  select
    flagged.aid,
    flagged.fname,
    flagged.lname,
    flagged.ret,
    flagged.completed,
    flagged.booked,
    flagged.attended,
    flagged.severely_late
  from flagged
  where not (
    flagged.board_exec
    or flagged.ret
    or (flagged.completed and flagged.attended and not flagged.severely_late)
  )
  order by
    coalesce(flagged.fname, ''),
    coalesce(flagged.lname, ''),
    flagged.aid;
end;
$$;

revoke all on function public.application_analytics_invalid(uuid) from public;
grant execute on function public.application_analytics_invalid(uuid) to authenticated;

-- Pick up the new return column on application_analytics_invalid.
notify pgrst, 'reload schema';
