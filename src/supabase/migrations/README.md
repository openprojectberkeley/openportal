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

> Note: the Supabase CLI expects a `supabase/` directory at the repo root. These
> live under `src/supabase/` for co-location; if you later adopt the CLI, move
> this folder to the project root (or symlink it).
