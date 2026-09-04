-- Adds an optional portfolio-link field to the written application, for
-- design applicants to share a link to their work (Behance, Dribbble,
-- personal site, etc.) alongside their resume. Applicant-level, per
-- application period, on `applications` — same shape as the other optional
-- "About you" fields added in 0050.
--
-- No new RLS: the applicant already owns their `applications` row via the
-- 0022 applications_insert/applications_update policies (self +
-- applications_open()); board/exec read via the 0016 applications SELECT
-- policy.

alter table public.applications
  add column if not exists portfolio_url text;
