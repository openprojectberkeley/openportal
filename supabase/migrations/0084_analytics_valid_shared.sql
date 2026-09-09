-- Lock both_valid and the invalid list to one shared predicate so
-- (submitted + accepted - both_valid) always equals the invalid list length.
-- Fixes drift when application_analytics() gained the 3+ day late rule (0081)
-- but application_analytics_invalid still used the coffee/info-only filter.
-- Formula matches client isRecruitingValid / isSeverelyLate (daysLate >= 3).

create or replace function public.is_recruiting_valid(
  p_applicant_id uuid,
  p_submitted_at timestamptz,
  p_ends_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from members_roles mr
      join roles rr on rr.id = mr.role_id
      where mr.user_id = p_applicant_id
        and rr.access_level in ('board', 'exec')
    )
    or exists (
      select 1 from members m
      where m.user_id = p_applicant_id
        and m.status in ('active', 'inactive')
    )
    or (
      exists (
        select 1 from coffee_chats c
        where c.applicant_id = p_applicant_id and c.complete
      )
      and exists (
        select 1 from infosesh_attendance i
        where i.applicant_id = p_applicant_id or i.member_id = p_applicant_id
      )
      and not (
        p_submitted_at is not null
        and p_ends_at is not null
        and p_submitted_at > p_ends_at + interval '2 days'
      )
    );
$$;

revoke all on function public.is_recruiting_valid(uuid, timestamptz, timestamptz) from public;
-- Internal helper for analytics RPCs; not granted to clients.


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
      public.is_recruiting_valid(a.applicant_id, a.submitted_at, per.ends_at) as is_valid
    from applications a
    left join application_periods per on per.id = a.period_id
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
    -- Valid measure excludes rejected (dropped) applicants.
    count(*) filter (
      where f.status in ('submitted', 'accepted') and f.is_valid
    )::int
  from application_periods p
  left join f on f.period_id = p.id
  group by p.id, p.name, p.created_at
  order by p.created_at desc;
end;
$$;

revoke all on function public.application_analytics() from public;
grant execute on function public.application_analytics() to authenticated;


-- Per-person invalid list — same is_recruiting_valid predicate as both_valid.
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
      (
        a.submitted_at is not null
        and per.ends_at is not null
        and a.submitted_at > per.ends_at + interval '2 days'
      ) as severely_late,
      public.is_recruiting_valid(a.applicant_id, a.submitted_at, per.ends_at) as is_valid
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
  where not flagged.is_valid
  order by
    coalesce(flagged.fname, ''),
    coalesce(flagged.lname, ''),
    flagged.aid;
end;
$$;

revoke all on function public.application_analytics_invalid(uuid) from public;
grant execute on function public.application_analytics_invalid(uuid) to authenticated;

notify pgrst, 'reload schema';
