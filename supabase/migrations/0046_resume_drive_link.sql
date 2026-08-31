-- Resumes are uploaded to a shared Google Drive folder (by the
-- upload-resume-drive edge function, using a service account) and reviewed in
-- the team's existing Drive-based reviewer. We keep a light reference on the
-- application so the in-app reviewer modal can link straight to the file.
--
-- No new RLS: the edge function writes these with the service role; reviewers
-- read them via the existing 0016 `applications` SELECT policy (own row or
-- is_board_or_exec()).

alter table public.applications
  add column if not exists resume_drive_file_id text,   -- Google Drive file id
  add column if not exists resume_drive_url     text,   -- webViewLink, for reviewers
  add column if not exists resume_filename      text,   -- applicant's original filename, for display
  add column if not exists resume_uploaded_at   timestamptz;
