-- A free-form markdown "page" on every portal.
--
-- The portal detail page's main content column has been intentionally blank
-- since 0006. This gives every portal (general/project/exec) one editable
-- markdown document there — links, meeting times, onboarding notes, whatever
-- the admins want to put in front of their members.
--
-- No new RLS is needed. Reads ride on portals_select (is_portal_member(id)) and
-- writes on portals_update (is_portal_admin(id)) — the same policies that gate
-- every other portal column. For a project portal that means the project's PMs,
-- who hold materialized is_admin rows from 0013.
--
-- Unlike the five project-projected fields, `content` is portal-owned: the 0031
-- lock_project_portal_fields trigger only overwrites name/description/icon/
-- icon_url/color, so it passes this column through untouched.

alter table public.portals
  add column if not exists content text;

comment on column public.portals.content is
  'Markdown source for the portal''s free-form page. Rendered read-only for members, edited in place by portal admins. Never rendered as raw HTML.';

-- Any portal admin can write this and every portal member reads it, so bound
-- the blast radius of an accidental paste-bomb well above any realistic page.
alter table public.portals drop constraint if exists portals_content_length_check;
alter table public.portals
  add constraint portals_content_length_check
  check (content is null or char_length(content) <= 100000);
