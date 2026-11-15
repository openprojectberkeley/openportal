-- Optional external links on every portal: GitHub, Notion, Slack, Linear.
--
-- Shown as icon buttons in the portal header; empty ones are hidden outside
-- edit mode. Like `content` (0099) these are portal-owned, so no new RLS:
-- reads ride on portals_select, writes on portals_update, and the 0031
-- lock_project_portal_fields trigger passes them through untouched.
--
-- Every portal member clicks these, and any portal admin writes them, so the
-- check pins them to http(s) — no javascript:/data: hrefs — and bounds length.

alter table public.portals
  add column if not exists github_url text,
  add column if not exists notion_url text,
  add column if not exists slack_url text,
  add column if not exists linear_url text;

alter table public.portals drop constraint if exists portals_links_check;
alter table public.portals
  add constraint portals_links_check check (
        (github_url is null or (github_url ~* '^https?://' and char_length(github_url) <= 2048))
    and (notion_url is null or (notion_url ~* '^https?://' and char_length(notion_url) <= 2048))
    and (slack_url  is null or (slack_url  ~* '^https?://' and char_length(slack_url)  <= 2048))
    and (linear_url is null or (linear_url ~* '^https?://' and char_length(linear_url) <= 2048))
  );
