-- Per-applicant rows backing the Applications manager's "Email blast" reminder
-- feature: everyone with an empty or unfinished draft application in a period,
-- so VP Tech/President can nudge them before the deadline.
--
-- Reuses the exact empty/unfinished classification from application_period_stats
-- (0053): a draft is "unfinished" once it has an essay on any ranking or >=1
-- application_answers row, otherwise "empty".
--
-- Excludes board/exec and any project PM — mirrors the boardExecEntries/pmEntries
-- exclusion already used client-side in manager/coffee-chats/all/page.tsx — since
-- those roles don't need an application reminder.
--
-- SECURITY DEFINER + is_vp_tech_or_president() guard (0047) — this feature is
-- restricted to VP Tech/President specifically, not exec generally, matching
-- the client-side gate (canSimulate && persona === "exec", same pattern as
-- canEditWindow in manager/coffee-chats/page.tsx). VP Tech/President can
-- already read every applicant row via the applications SELECT RLS (0016)
-- and every members_roles/project_members row (no RLS restricts those tables
-- to a subset of users), so this exposes nothing new.
create or replace function public.application_period_draft_applicants(p_period_id uuid)
returns table (
  user_id           uuid,
  preferred_firstname text,
  lastname          text,
  email             text,
  draft_state       text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_vp_tech_or_president() then
    raise exception 'not authorized';
  end if;

  return query
  with app as (
    select
      a.applicant_id,
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
      and a.status = 'draft'
  ),
  excluded_users as (
    select mr.user_id
    from members_roles mr
    join roles r on r.id = mr.role_id
    where r.access_level in ('board', 'exec')
    union
    select pm.user_id from project_members pm where pm.is_pm = true
  )
  select
    m.user_id,
    m.preferred_firstname,
    m.lastname,
    m.email,
    case when app.has_content then 'unfinished' else 'empty' end
  from app
  join members m on m.user_id = app.applicant_id
  where not exists (select 1 from excluded_users eu where eu.user_id = m.user_id)
  order by app.has_content, m.lastname, m.preferred_firstname;
end;
$$;

revoke all on function public.application_period_draft_applicants(uuid) from public;
grant execute on function public.application_period_draft_applicants(uuid) to authenticated;
