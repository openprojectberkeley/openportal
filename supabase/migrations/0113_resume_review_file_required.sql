-- Finishes the move to frozen resume review files (0112).
--
-- Run only after the app that uses /api/resume-reviews is deployed and
-- scripts/backfill_resume_review_files.mjs reports nothing left to copy.
--
-- Requests are now created and withdrawn only through /api/resume-reviews. The
-- old withdraw policy could also change other columns on the row, because RLS
-- only checked the status it landed on.

drop policy if exists "resume_reviews_insert_own" on public.resume_reviews;
drop policy if exists "resume_reviews_cancel_own" on public.resume_reviews;

alter table public.resume_reviews
  drop constraint if exists resume_reviews_file_required;
alter table public.resume_reviews
  add constraint resume_reviews_file_required
  check (status = 'cancelled' or file_path is not null);
