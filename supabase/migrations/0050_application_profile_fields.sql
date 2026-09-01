-- Re-add the optional "About you" fields to the written application (they were
-- added in 0043 and dropped in the 0045 rollback; bringing them back per product
-- decision). Applicant-level, per application period, on `applications`:
--
--   tech_area_rankings jsonb  — { areaKey: 1..5 } interest ratings
--   tech_classes       jsonb  — [classKey, ...] the checklist selections
--   tech_classes_other text   — free-text list of other relevant classes
--   about_note         text   — the free-text "anything else" answer (after rankings)
--
-- No new RLS: the applicant already owns their `applications` row via the 0022
-- applications_insert/applications_update policies (self + applications_open());
-- board/exec read via the 0016 applications SELECT policy. (Resume is separate —
-- member-level, see 0049.)

alter table public.applications
  add column if not exists tech_area_rankings jsonb not null default '{}'::jsonb,
  add column if not exists tech_classes       jsonb not null default '[]'::jsonb,
  add column if not exists tech_classes_other text,
  add column if not exists about_note         text;
