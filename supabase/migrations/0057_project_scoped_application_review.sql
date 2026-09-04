-- Scope application review to the reviewer's own project(s).
--
-- Previously any board/exec (is_board_or_exec()) could see and act on every
-- applicant across every project. Now a reviewer can only see/act on an
-- applicant's ranking for a project they PM (project_members.is_pm), unless
-- they hold one of three org-wide roles that keep full visibility: VP Tech,
-- President (both already special-cased in 0004/0047), and VP Projects
-- (new here).
--
--   1. is_vp_projects(): mirrors is_president() (0047).
--   2. can_review_all_projects(): is_vp_tech() or is_president() or
--      is_vp_projects(). The "sees everything" combinator.
--   3. can_review_project(p_project_id): can_review_all_projects() or PM of
--      that specific project. The scoped combinator every policy/RPC below
--      calls instead of is_board_or_exec().
--   4. applications/application_rankings/application_answers SELECT: replace
--      the is_board_or_exec() branch with can_review_all_projects() plus a
--      per-row/joined can_review_project() check, so a scoped reviewer only
--      ever sees rows tied to a project they can review. `ranked = true`
--      only — an un-ranked (removed) choice isn't something to review.
--   5. accept_application(): now requires can_review_project(p_project_id)
--      instead of is_board_or_exec() — a reviewer can only place an applicant
--      onto a project they can review. Placement still sets members.status =
--      'active', unchanged.
--   6. reject_application(): has no project param (it rejects the whole
--      application), so it requires can_review_all_projects() or
--      can_review_project() on at least one of the applicant's currently
--      ranked projects.
--
-- Not touched: is_board_or_exec() itself (still gates the /manager route tree
-- and set_member_status — the general admin status editor is a separate tool
-- from project-scoped review, out of scope here) and the "view as" simulation
-- role list (src/lib/roles.ts ELEVATED_ROLE_NAMES) which VP Projects is
-- deliberately not added to.

-- 1-3. Role/authorization helpers ---------------------------------------------

create or replace function public.is_vp_projects()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.members_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.user_id = auth.uid()
      and r.role_name = 'VP Projects'
  );
$$;

grant execute on function public.is_vp_projects() to authenticated;

create or replace function public.can_review_all_projects()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_vp_tech() or public.is_president() or public.is_vp_projects();
$$;

grant execute on function public.can_review_all_projects() to authenticated;

create or replace function public.can_review_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.can_review_all_projects()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
        and pm.is_pm
    );
$$;

grant execute on function public.can_review_project(uuid) to authenticated;

-- 4. Scope SELECT policies to reviewable projects -----------------------------

drop policy if exists "applications_select" on public.applications;
create policy "applications_select"
on public.applications
for select
to authenticated
using (
  applicant_id = auth.uid()
  or public.can_review_all_projects()
  or exists (
    select 1 from public.application_rankings r
    where r.application_id = applications.id
      and r.ranked
      and public.can_review_project(r.project_id)
  )
);

drop policy if exists "application_rankings_select" on public.application_rankings;
create policy "application_rankings_select"
on public.application_rankings
for select
to authenticated
using (
  public.can_review_project(project_id)
  or exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_answers_select" on public.application_answers;
create policy "application_answers_select"
on public.application_answers
for select
to authenticated
using (
  exists (
    select 1
    from public.application_rankings r
    where r.id = application_answers.ranking_id
      and public.can_review_project(r.project_id)
  )
  or exists (
    select 1
    from public.application_rankings r
    join public.applications a on a.id = r.application_id
    where r.id = application_answers.ranking_id
      and a.applicant_id = auth.uid()
  )
);

-- 5. accept_application(): reviewer must be able to review the target project -

create or replace function public.accept_application(p_application_id uuid, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applicant uuid;
begin
  if not public.can_review_project(p_project_id) then
    raise exception 'not authorized';
  end if;

  select applicant_id into v_applicant
  from public.applications
  where id = p_application_id;

  if v_applicant is null then
    raise exception 'application not found';
  end if;

  update public.applications
  set status = 'accepted',
      accepted_project_id = p_project_id,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_application_id;

  insert into public.project_members (project_id, user_id, is_pm)
  values (p_project_id, v_applicant, false)
  on conflict (project_id, user_id) do nothing;

  -- Accepting always makes the applicant active, regardless of prior status.
  update public.members
  set status = 'active'
  where user_id = v_applicant;
end;
$$;

grant execute on function public.accept_application(uuid, uuid) to authenticated;

-- 6. reject_application(): reviewer must be able to review at least one of the
-- applicant's currently ranked projects --------------------------------------

create or replace function public.reject_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.can_review_all_projects()
    or exists (
      select 1 from public.application_rankings r
      where r.application_id = p_application_id
        and r.ranked
        and public.can_review_project(r.project_id)
    )
  ) then
    raise exception 'not authorized';
  end if;

  update public.applications
  set status = 'rejected',
      accepted_project_id = null,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_application_id;

  if not found then
    raise exception 'application not found';
  end if;
end;
$$;

grant execute on function public.reject_application(uuid) to authenticated;
