-- Partly revert the resume work: remove the private Supabase resume bucket and
-- the heuristic parsing (resumes now go to a Google Drive folder — see 0046 +
-- the upload-resume-drive edge function). The rest of the "About you" section
-- (technical-area ratings, tech-classes checklist, free-text note) is KEPT, so
-- its columns from 0043 are left in place. Idempotent.

-- 1. Storage policies for the private resume bucket (0043). --------------------
drop policy if exists "application_resumes_insert" on storage.objects;
drop policy if exists "application_resumes_update" on storage.objects;
drop policy if exists "application_resumes_delete" on storage.objects;
drop policy if exists "application_resumes_read" on storage.objects;

-- 2. The `application-resumes` bucket must be removed via the Storage API, NOT
--    SQL: Postgres blocks direct DELETE from storage.objects
--    (storage.protect_delete()). Empty then delete the bucket in the dashboard
--    (Storage -> application-resumes -> Empty bucket, then Delete bucket), or
--    with the service role:
--      await supabase.storage.emptyBucket('application-resumes')
--      await supabase.storage.deleteBucket('application-resumes')

-- 3. Drop only the Supabase-storage / parsing resume columns (0043 + 0044).
--    `resume_filename` is kept (reused for the Drive filename in 0046); the
--    tech-area / tech-classes / note columns are kept.
alter table public.applications
  drop column if exists resume_path,
  drop column if exists resume_parsed;
