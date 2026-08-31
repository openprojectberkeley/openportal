-- Structured breakdown of an applicant's uploaded resume, parsed client-side
-- (heuristically) into sections and then edited/confirmed by the applicant.
-- Stored as JSON on their own application row.
--
-- Shape (see src/lib/resume-parse.ts `ResumeParsed`):
--   { contact, education[], experience[], projects[], skills[], awards[], other[] }
--
-- No new RLS: the applicant already owns their `applications` row (0022
-- applications_update self + applications_open()); board/exec read via the 0016
-- applications SELECT policy.

alter table public.applications
  add column if not exists resume_parsed jsonb;
