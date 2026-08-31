-- Revert 0043 (application profile + private resume bucket) and 0044
-- (resume_parsed). The "About you" section and heuristic resume parsing were
-- dropped from the product; resumes now go straight to a Google Drive folder
-- (see 0046 + the upload-resume-drive edge function). Idempotent.

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

-- 3. The application-profile / resume columns (0043 + 0044). ------------------
alter table public.applications
  drop column if exists tech_area_rankings,
  drop column if exists tech_classes,
  drop column if exists tech_classes_other,
  drop column if exists resume_path,
  drop column if exists resume_filename,
  drop column if exists about_note,
  drop column if exists resume_parsed;
