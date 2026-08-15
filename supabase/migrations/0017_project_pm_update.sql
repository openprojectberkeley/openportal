-- Let a project's PMs edit that project's details from its project portal.
--
-- 0005 restricted all project writes to exec. PMs manage their project portal,
-- so they should also be able to edit the underlying project (name, type,
-- client, difficulty, size, description). This widens UPDATE only — creating
-- and deleting projects stays exec-only (still done from the admin panel).

drop policy if exists "projects_update_exec" on public.projects;
drop policy if exists "projects_update" on public.projects;
create policy "projects_update"
on public.projects
for update
to authenticated
using (
  public.is_exec()
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = projects.id
      and pm.user_id = auth.uid()
      and pm.is_pm
  )
)
with check (
  public.is_exec()
  or exists (
    select 1 from public.project_members pm
    where pm.project_id = projects.id
      and pm.user_id = auth.uid()
      and pm.is_pm
  )
);
