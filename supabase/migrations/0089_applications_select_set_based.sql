-- Speed up applications SELECT under RLS.
--
-- applications_select (0057) gated the reviewer branch on
-- application_has_reviewable_ranking(applications.id). That helper is correct
-- but takes the row id, so Postgres evaluates it once per candidate row. With
-- ~300 submitted apps in a period × nested can_review_project() calls, the
-- manager Applications list query (applications + application_rankings!inner)
-- routinely hits statement_timeout (HTTP 500) for PMs — and even for
-- can_review_all_projects() users, because an OR arm that depends on the row
-- id is still evaluated per row.
--
-- Fix: keep the same authorization (applicant owns the row, or org-wide
-- reviewer, or PM of a project the applicant ranked), but express the PM
-- branch as `id in (select application_ids_reviewable_as_pm())`. That is a
-- hashed SubPlan computed once (SECURITY DEFINER so it does not recurse into
-- application_rankings RLS). can_review_all_projects() can then short-circuit
-- without paying the per-row cost.
--
-- Also rewrite application_has_reviewable_ranking() to the same join shape
-- (used by reject_application and any leftover callers), drop a duplicate
-- legacy applicant SELECT policy, and add (project_id) WHERE ranked for the
-- list query's ranking filter.

create or replace function public.application_ids_reviewable_as_pm()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select distinct r.application_id
  from public.application_rankings r
  join public.project_members pm
    on pm.project_id = r.project_id
   and pm.user_id = auth.uid()
   and pm.is_pm
  where r.ranked;
$$;

grant execute on function public.application_ids_reviewable_as_pm() to authenticated;

create or replace function public.application_has_reviewable_ranking(p_application_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.can_review_all_projects()
    or exists (
      select 1
      from public.application_rankings r
      join public.project_members pm
        on pm.project_id = r.project_id
       and pm.user_id = auth.uid()
       and pm.is_pm
      where r.application_id = p_application_id
        and r.ranked
    );
$$;

drop policy if exists "Users can see their info" on public.applications;

drop policy if exists "applications_select" on public.applications;
create policy "applications_select"
on public.applications
for select
to authenticated
using (
  applicant_id = auth.uid()
  or public.can_review_all_projects()
  or applications.id in (select public.application_ids_reviewable_as_pm())
);

create index if not exists application_rankings_project_ranked_idx
  on public.application_rankings (project_id)
  where ranked;
