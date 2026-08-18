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
| `0016_project_types_and_applications.sql` | Adds `projects.type` (studio/launch, default launch), `difficulty` (1-5), `estimated_members`, `num_subteams`; CHECK requiring a client for Studio; folds PMs into `is_board_or_exec()` (board = exec + PMs); `applications` + `application_rankings` tables + RLS (applicant manages own, board/exec read all). |
| `0017_project_pm_update.sql` | Widens `projects` UPDATE RLS so a project's PMs (not just exec) can edit that project's details; insert/delete stay exec-only. |
| `0018_project_difficulty_levels.sql` | Changes `projects.difficulty` from a 1-5 smallint to named levels (`beginner`/`intermediate`/`advanced`) with a matching CHECK. |
| `0019_project_type_exec_only.sql` | BEFORE UPDATE trigger on `projects`: only exec can change a project's `type` (Studio/Launch); PMs can still edit other fields. |
| `0020_application_questions_and_drafts.sql` | Adds `applications.status` (draft/submitted, `submitted_at` now nullable); makes `application_rankings` draft-friendly (rank no longer unique, `essay` nullable, adds `completed`/`updated_at`); adds `project_questions` (per-project custom questions, RLS exec/PM) + `application_answers` (applicant responses, RLS own/board+exec-read). |
| `0021_application_rankings_soft_remove.sql` | Adds `application_rankings.ranked` (bool). Removing a project from the ranking soft-removes it (ranked=false) so its essay/answers survive and re-adding restores them; only ranked=true rows form the current ranking. |
| `0022_application_periods_and_acceptance.sql` | Adds `application_periods` (named cycles: name/window/status draft-open-closed, RLS read-all + exec-write) + `applications_open()`/`current_application_period()` helpers. Extends `applications` with `period_id`, `accepted_project_id`, `reviewed_at`/`reviewed_by`; widens status CHECK to draft/submitted/accepted/rejected; switches uniqueness to one-per-applicant-*per-period* (seeds an initial open period + backfills). Adds `accept_application`/`reject_application` SECURITY DEFINER RPCs (board/exec; accept places the applicant on a project via `project_members` and sets `members.active=true`). Gates applicant writes (applications/rankings/answers) on `applications_open()`. Adds `is_returning_member()` (= `members.active`); first-timers (inactive) may only rank OP Launch projects (RLS on `application_rankings` + a guard in `accept_application` blocking Studio placement of a first-timer). |
| `0023_application_status_drives_open.sql` | Redefines `applications_open()` / `current_application_period()` so a period's `status = 'open'` alone opens applications, independent of its start/end window (which becomes an informational schedule). Exec can open a period early or keep it open "outside window" without editing dates. |

> Note: the Supabase CLI expects a `supabase/` directory at the repo root. These
> live under `src/supabase/` for co-location; if you later adopt the CLI, move
> this folder to the project root (or symlink it).
