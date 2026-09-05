-- Add recruiting-funnel counts to application_period_stats.
--
-- Reviewers wanted, alongside the Pending/Accepted/Rejected breakdown, a sense of
-- how many of the period's *submitted* applicants actually completed a coffee
-- chat and attended an info session. This extends the 0053 RPC with two more
-- counts, both scoped to the submitted set (status in submitted/accepted/rejected)
-- so they read as ratios against the "Completed" applications total the UI already
-- shows.
--
--   * coffee_chat_valid     -- submitted applicants whose coffee-chat status is
--                              valid: they have a chat *booked or completed* (any
--                              coffee_chats row under their applicant_id), OR they
--                              are a returning member (members.status in
--                              active/inactive — the is_returning_member() rule
--                              from 0042), who are exempt from the requirement.
--   * infosession_attended  -- submitted applicants who attended an info session,
--                              matched on applicant_id OR member_id (attendance is
--                              recorded under either, both auth user ids) — same
--                              match the profile API and manager page use.
--
-- coffee_chats / infosesh_attendance have no period_id, so both counts key on the
-- period's applicant_id set. Counting per-application (not per chat row) already
-- dedupes: applications is unique per (applicant_id, period_id), so each submitter
-- is counted at most once regardless of how many chat rows they have.
--
-- The return TABLE shape changes, so a plain create-or-replace is rejected — drop
-- then recreate. Guard + grants unchanged from 0053 (SECURITY DEFINER, board/exec
-- only; they already read every applicant row via the applications SELECT RLS).

drop function if exists public.application_period_stats(uuid);

create function public.application_period_stats(p_period_id uuid)
returns table (
  empty_drafts          integer,
  unfinished_drafts     integer,
  submitted             integer,
  accepted              integer,
  rejected              integer,
  coffee_chat_valid     integer,
  infosession_attended  integer
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

revoke all on function public.application_period_stats(uuid) from public;
grant execute on function public.application_period_stats(uuid) to authenticated;
