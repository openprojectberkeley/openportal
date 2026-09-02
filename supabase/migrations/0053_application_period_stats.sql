-- Exec-facing application funnel stats for the review modal.
--
-- The Applications manager only ever loads submitted/accepted/rejected rows, so
-- reviewers have no sense of the wider funnel: how many people started an
-- application and never finished, and how many drafts are completely empty.
-- This read-only RPC aggregates those counts for one application period so the
-- Applications manager page can show them above the list as period context.
--
-- Draft classification (verified against the applicant write paths):
--   * empty draft      -- status='draft' with no content anywhere: no non-empty
--                         essay on any ranking AND no application_answers rows.
--   * unfinished draft -- status='draft' that started (an essay or >=1 answer).
--   * completed        -- status in ('submitted','accepted','rejected').
-- Empty essays are stored as NULL and only non-empty answers are ever inserted,
-- so an application_answers row (under ANY ranking, ranked or soft-removed)
-- means the applicant wrote something real.
--
-- SECURITY DEFINER + is_board_or_exec() guard, mirroring accept/reject_application
-- (0022). Board/exec can already read every applicant row via the applications
-- SELECT RLS (0016), so this exposes nothing new; the exec-only visibility is a
-- UI concern enforced on the client.
create or replace function public.application_period_stats(p_period_id uuid)
returns table (
  empty_drafts      integer,
  unfinished_drafts integer,
  submitted         integer,
  accepted          integer,
  rejected          integer
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
      ) as has_content
    from applications a
    where a.period_id = p_period_id
  )
  select
    count(*) filter (where status = 'draft' and not has_content)::int,
    count(*) filter (where status = 'draft' and has_content)::int,
    count(*) filter (where status = 'submitted')::int,
    count(*) filter (where status = 'accepted')::int,
    count(*) filter (where status = 'rejected')::int
  from app;
end;
$$;

revoke all on function public.application_period_stats(uuid) from public;
grant execute on function public.application_period_stats(uuid) to authenticated;
