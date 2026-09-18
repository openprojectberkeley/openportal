-- Lets a project's PMs (not just exec) add/remove members and toggle PM on
-- their own project, so the project-portal roster modal can edit managed
-- rows by writing through to project_members (the 0013 sync triggers then
-- mirror the change into portal_members).
--
-- Before this, every drafted member -- placed via complete_draft() ->
-- accept_application() -> project_members -> managed portal row -- showed up
-- locked in the portal roster (no crown toggle, no remove), while members
-- added from the portal modal itself became unmanaged portal-only rows that
-- were editable but never actually joined the project.

drop policy if exists "project_members_insert_exec" on public.project_members;
create policy "project_members_insert_exec"
on public.project_members
for insert
to authenticated
with check ( public.can_edit_project(project_id) );

drop policy if exists "project_members_update_exec" on public.project_members;
create policy "project_members_update_exec"
on public.project_members
for update
to authenticated
using ( public.can_edit_project(project_id) )
with check ( public.can_edit_project(project_id) );

drop policy if exists "project_members_delete_exec" on public.project_members;
create policy "project_members_delete_exec"
on public.project_members
for delete
to authenticated
using ( public.can_edit_project(project_id) );
