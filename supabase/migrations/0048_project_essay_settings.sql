-- Let PMs/exec edit the fixed application essay's prompt and required-ness per
-- project (previously hardcoded in the applicant modal). Defaults match the old
-- hardcoded copy, so existing projects behave identically until edited.
-- Writes go through the existing `projects` UPDATE RLS policy (0017) — no new
-- policy needed.

alter table public.projects
  add column if not exists essay_prompt text not null default 'Why do you want to work on this project?';
alter table public.projects
  add column if not exists essay_required boolean not null default true;
