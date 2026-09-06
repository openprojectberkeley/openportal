-- Board/exec applicants are automatically "valid".
--
-- Recruiting validity previously required, over the submitted set:
--   (completed a coffee chat OR returning member) AND attended an info session.
-- We now exempt anyone who currently holds a board- or exec-level role
-- (roles.access_level in ('board','exec') — the same grouping is_board_or_exec()
-- uses, but tested against the *applicant* rather than the caller). Such members
-- are valid regardless of coffee-chat or info-session status.
--
-- This recreates both analytics functions from 0063/0064 with the new predicate:
--   both_valid / not-invalid = board_or_exec
--                              OR ((completed OR returning) AND attended)
-- The per-funnel coffee/info category counts are unchanged — they still report
-- actual attendance; only the combined "valid" measure gains the role exemption.
-- Because of that, both_valid is no longer strictly the intersection of the two
-- funnels: a board/exec member who skipped both can still be valid.
--
-- Signatures are unchanged from 0063/0064, so `create or replace` suffices.
-- Guards, security, and grants are carried over unchanged.

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
      ) as is_be
    from applications a
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
    count(*) filter (where f.sub and (f.is_be or ((f.did_complete or f.is_ret) and f.did_att)))::int
  from application_periods p
  left join f on f.period_id = p.id
  group by p.id, p.name, p.created_at
  order by p.created_at desc;
end;
$$;

revoke all on function public.application_analytics() from public;
grant execute on function public.application_analytics() to authenticated;


-- Per-person "invalid" list — now also excludes board/exec (they're auto-valid).
create or replace function public.application_analytics_invalid(p_period_id uuid)
returns table (
  applicant_id        uuid,
  preferred_firstname text,
  lastname            text,
  is_returning        boolean,
  did_complete        boolean,
  has_chat            boolean,
  did_att             boolean
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
      ) as board_exec
    from applications a
    left join members m on m.user_id = a.applicant_id
    where a.period_id = p_period_id
      and a.status in ('submitted', 'accepted', 'rejected')
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
  where not (flagged.board_exec or ((flagged.completed or flagged.ret) and flagged.attended))
  order by
    coalesce(flagged.fname, ''),
    coalesce(flagged.lname, ''),
    flagged.aid;
end;
$$;

revoke all on function public.application_analytics_invalid(uuid) from public;
grant execute on function public.application_analytics_invalid(uuid) to authenticated;
