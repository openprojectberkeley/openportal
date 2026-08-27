-- Restrict who can read a project's member roster.
--
-- 0005 made project_members world-readable (project_members_select USING(true)),
-- so any signed-in user could enumerate the full roster of every project. Basic
-- project info (the `projects` table) stays intentionally world-readable, but the
-- roster ("who is on this project") is a project detail that should be visible
-- only to that project's own members and to exec — the same audience that can see
-- the project's portal, events, and portal roster.
--
-- Carve-out: PM rows (is_pm = true) stay world-visible. The applicant coffee-chat
-- flow (an OP Studio applicant must chat with a project's PM) and the application
-- ranking flow (shows each project's PM) both read other projects' PMs, and PMs
-- are the public-facing lead for a project. Regular (non-PM) members are hidden
-- from users who aren't on the project.

-- Helper: is the current user a member of this project? SECURITY DEFINER so the
-- inner read bypasses RLS — this is what the project_members SELECT policy calls,
-- and a plain (RLS-subject) self-reference would recurse. Safe while
-- project_members is not FORCE ROW LEVEL SECURITY (it isn't).
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_project_member(uuid) to authenticated;

-- Roster read: PM rows to everyone; the full roster only to exec and to fellow
-- members of the same project. Supersedes 0005's project_members_select.
drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select"
on public.project_members
for select
to authenticated
using (
  is_pm
  or public.is_exec()
  or public.is_project_member(project_id)
);
