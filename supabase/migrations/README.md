# Supabase migrations

The database schema for this project is managed in the Supabase dashboard. These
files capture the schema/RLS changes that have been introduced alongside the app
so they're reviewable and reproducible.

Each file is written to be **idempotent** (`if not exists`, `create or replace`,
`drop policy if exists`), so it's safe to run against the existing database — run
them in order in the Supabase SQL editor.

| File | What it does |
| --- | --- |
| `0001_members_email.sql` | Adds `members.email`. |
| `0002_infosesh_attendance_rls.sql` | `is_board_or_exec()` + RLS for infosession codes. |
| `0003_coffee_chats_one_per_person.sql` | Optional unique index: one chat per applicant per member. |
| `0004_app_settings_coffee_chat_window.sql` | `app_settings` table + `is_vp_tech()` + RLS for the coffee-chat window. |
| `0005_projects.sql` | `projects` + `project_members` tables, `is_exec()`, RLS (read: all signed-in, write: exec). |
| `0009_infosesh_attendance_one_per_applicant.sql` | Unique index: one infosession code claim per applicant. |
| `0010_member_avatars.sql` | Adds `members.avatar_url`; public `avatars` Storage bucket + RLS (public read, write only within `{uid}/`). |
| `0011_portal_event_attendance.sql` | `portal_event_attendance` junction (member × portal event, present/absent/excused) + `is_event_portal_admin()` + RLS (members read own, portal admins manage). |
| `0012_portal_types.sql` | Adds `portals.type` (general/project/exec) + `project_id`; `is_pm()`; derives project-portal membership in `is_portal_admin`/`is_portal_member`; reworks portal insert/update/delete RLS (exec any type, PMs general/own-project, exec delete-only) + creator-admin trigger. |
| `0013_project_portal_membership_sync.sql` | Materializes project-portal rosters into `portal_members` (`managed` flag): populate-on-create + sync triggers on `project_members` (member→member, PM→admin), locks managed rows in RLS, drops the derived branches from the membership helpers, and backfills existing project portals. |
| `0014_portal_owner_admin.sql` | Portal creator (exec or PM, any type) gets a locked `is_owner` admin row; owner rows are RLS-locked and never demoted/removed by the project-sync triggers. |
| `0015_portal_icons.sql` | Adds `portals.icon_url`; public `portals` Storage bucket + RLS (public read, write gated by `is_portal_admin(portal_id)` on the `{portal_id}/icon.jpg` path). |

> Note: the Supabase CLI expects a `supabase/` directory at the repo root. These
> live under `src/supabase/` for co-location; if you later adopt the CLI, move
> this folder to the project root (or symlink it).
