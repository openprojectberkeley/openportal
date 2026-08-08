---
paths:
  - "supabase/**"
---

# Supabase change rules

Any change to the Supabase schema, RLS policies, functions, or other database
objects must be written as a SQL migration file in `supabase/migrations/`, not
applied only through the dashboard.

Name the file based on whether the change is permanent or one-time:

- **Permanent change** (schema, RLS, functions — anything that should stay
  forever): `xxxx_description.sql`, where `xxxx` is the next sequential
  4-digit number after the highest one already in `supabase/migrations/`
  (e.g. `0009_add_project_tags.sql`).
- **One-time change** (a manual backfill, data fix, or cleanup script that
  isn't meant to be replayed as part of the permanent schema history):
  `DDMMYYYY_description.sql`, using today's date (e.g.
  `08082026_backfill_missing_emails.sql`).

Other conventions to follow (see `supabase/migrations/README.md`):

- Write migrations to be **idempotent** (`if not exists`, `create or
  replace`, `drop policy if exists`) so they're safe to re-run.
- Use a short, descriptive `snake_case` description after the prefix.
- Update `supabase/migrations/README.md`'s table with the new file and what
  it does.
