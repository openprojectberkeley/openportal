-- OP Studio: returning-member PRIORITY, not requirement.
--
-- Previously first-time applicants (status not in active/inactive) were blocked
-- from OP Studio entirely — an RLS gate on application_rankings and a guard in
-- accept_application() rejected any Studio ranking/placement for them. We now
-- let anyone rank and be placed on OP Studio projects; returning members are
-- merely prioritized (surfaced in the UI), no longer required.
--
-- is_returning_member() is left in place — it's still a useful predicate — but
-- it no longer gates Studio ranking or acceptance.

-- 1. application_rankings insert/update: drop the returning-member restriction --

drop policy if exists "application_rankings_insert" on public.application_rankings;
create policy "application_rankings_insert"
on public.application_rankings
for insert
to authenticated
with check (
  public.applications_open()
  and exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);

drop policy if exists "application_rankings_update" on public.application_rankings;
create policy "application_rankings_update"
on public.application_rankings
for update
to authenticated
using (
  exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
)
with check (
  public.applications_open()
  and exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.applicant_id = auth.uid()
  )
);

-- 2. accept_application(): drop the first-timer Studio guard -------------------

create or replace function public.accept_application(p_application_id uuid, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applicant uuid;
begin
  if not public.is_board_or_exec() then
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
