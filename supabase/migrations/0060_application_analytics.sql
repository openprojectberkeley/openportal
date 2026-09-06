-- Exec-facing recruiting analytics across all application periods.
--
-- Backs the "View analytics" modal on the Applications manager page: per-period
-- funnel counts plus the coffee-chat and info-session breakdowns for the pie
-- charts and the historical "valid %" table. Returns one row per period (all
-- periods, newest first) so the modal can render both the current pies and the
-- history in a single fetch.
--
-- Breakdowns are over the *submitted* applicant set (status in
-- submitted/accepted/rejected) and each is a mutually-exclusive partition by
-- priority, so the slices always sum to `submitted`:
--   coffee: completed > booked > returning > nothing
--     * completed -- a coffee_chats row with complete = true
--     * booked    -- has a coffee_chats row but none complete
--     * returning -- no chat, but a returning member (members.status in
--                    active/inactive, the is_returning_member() rule from 0042),
--                    who is exempt from the requirement so it "doesn't matter"
--     * nothing   -- no chat and not returning
--   info: attended > returning > nothing
--     * attended  -- an infosesh_attendance row (matched on applicant_id OR
--                    member_id, both auth user ids)
--     * returning -- no attendance, but a returning member (exempt)
--     * nothing   -- no attendance and not returning
--
-- coffee_chats / infosesh_attendance have no period_id, so the per-applicant
-- checks key on applicant_id; counting per-application dedupes (applications is
-- unique per applicant_id+period_id). The empty/unfinished draft classification
-- mirrors application_period_stats (0053).
--
-- SECURITY DEFINER + is_board_or_exec() guard, mirroring application_period_stats
-- (0053) / accept-reject_application (0022). Board/exec already read every
-- applicant row via the applications SELECT RLS (0016), so this exposes nothing
-- new; the exec-only visibility is a UI concern enforced on the client.

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
  info_nothing      integer
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
    count(*) filter (where f.sub and f.info_cat = 'nothing')::int
  from application_periods p
  left join f on f.period_id = p.id
  group by p.id, p.name, p.created_at
  order by p.created_at desc;
end;
$$;

revoke all on function public.application_analytics() from public;
grant execute on function public.application_analytics() to authenticated;
