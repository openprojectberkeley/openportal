-- Applicant background on the written application: technical-area interest
-- ratings, tech classes taken, a resume file, and a free-text note. All are
-- optional and live on the applicant's own `applications` row (except the
-- resume file, which goes to a private Storage bucket).
--
--   * tech_area_rankings jsonb  — { areaKey: 1..5 } (only rated areas present)
--   * tech_classes       jsonb  — [classKey, ...] the checklist selections
--   * tech_classes_other text   — free-text list of other relevant classes
--   * resume_path        text   — object path in the private resume bucket
--   * resume_filename    text   — original filename, for display
--   * about_note         text   — "anything else you'd like us to know"
--
-- No new table RLS: the applicant already owns their `applications` row via the
-- 0022 applications_insert/applications_update policies (self + applications_open()).

-- 1. Applicant-level columns. ------------------------------------------------
alter table public.applications
  add column if not exists tech_area_rankings jsonb not null default '{}'::jsonb,
  add column if not exists tech_classes       jsonb not null default '[]'::jsonb,
  add column if not exists tech_classes_other text,
  add column if not exists resume_path        text,
  add column if not exists resume_filename    text,
  add column if not exists about_note         text;

-- 2. Private resume bucket — mirrors the avatars/projects buckets (0010/0031),
--    but NOT public: resumes are read only by their owner and by reviewers,
--    through short-lived signed URLs. Object path: `{user_id}/{period_id}/resume.<ext>`.
insert into storage.buckets (id, name, public)
values ('application-resumes', 'application-resumes', false)
on conflict (id) do update set public = false;

-- Owner (applicant) may write/replace/delete files under their own uid folder.
drop policy if exists "application_resumes_insert" on storage.objects;
create policy "application_resumes_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'application-resumes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "application_resumes_update" on storage.objects;
create policy "application_resumes_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'application-resumes'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'application-resumes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "application_resumes_delete" on storage.objects;
create policy "application_resumes_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'application-resumes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Read: the owner, or board/exec reviewers (so they can mint signed URLs).
drop policy if exists "application_resumes_read" on storage.objects;
create policy "application_resumes_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'application-resumes'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_board_or_exec()
  )
);
