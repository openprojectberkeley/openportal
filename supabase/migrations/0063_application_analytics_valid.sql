-- Adds a combined "valid" count to the recruiting analytics RPC.
--
-- Supersedes 0060's signature: same function, same body, plus a trailing
-- `both_valid` column =
--   (completed a coffee chat OR returning member) AND attended an info session
-- over the submitted set. A booked-but-incomplete chat does not count, and
-- returning exempts only the coffee chat, not the info session. This is exactly
-- the intersection of the two per-funnel valid rates as the analytics modal
-- defines them (coffee valid = completed or returning; info valid = attended).
--
-- The count can't be derived from 0060's existing columns: coffee_cat is a
-- mutually-exclusive partition by priority, so a returning member who also has a
-- booked-but-incomplete chat lands in 'booked', not 'returning'. The aggregate
-- therefore reads the raw booleans (did_complete / is_ret / did_att), which are
-- now carried through the `f` CTE alongside the category labels.
--
-- `create or replace` can't add a column to a RETURNS TABLE, so this drops and
-- recreates. Guard/security/grants are unchanged from 0060.

drop function if exists public.application_analytics();

create function public.application_analytics()
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
      ) as did_att
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
    count(*) filter (where f.sub and (f.did_complete or f.is_ret) and f.did_att)::int
  from application_periods p
  left join f on f.period_id = p.id
  group by p.id, p.name, p.created_at
  order by p.created_at desc;
end;
$$;

revoke all on function public.application_analytics() from public;
grant execute on function public.application_analytics() to authenticated;
