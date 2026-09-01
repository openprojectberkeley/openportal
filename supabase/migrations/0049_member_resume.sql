-- Resume upload, reverted to Supabase Storage (the Google Drive route was a dead
-- end: the org blocks service-account keys and there's no Shared Drive). The
-- resume is now MEMBER-level — one per person, ever — stored on `members` with a
-- single object per user in the private `application-resumes` bucket
-- (`{user_id}/resume.<ext>`), replaced on every new upload.

-- 1. Member-level resume reference. -----------------------------------------
-- `members` already has self-update RLS (auth.uid() = user_id) and open SELECT,
-- so applicants write these and board/exec read them without new table policies.
alter table public.members
  add column if not exists resume_path        text,
  add column if not exists resume_filename    text,
  add column if not exists resume_uploaded_at timestamptz;

-- 2. Drop the abandoned Google Drive columns (0046). ------------------------
alter table public.applications
  drop column if exists resume_drive_file_id,
  drop column if exists resume_drive_url,
  drop column if exists resume_filename,
  drop column if exists resume_uploaded_at;

-- 3. Private resume bucket + storage policies. The bucket already exists from
--    0043; 0045 dropped its policies. Re-create them (keyed to the {user_id}
--    first path segment), mirroring 0043. ------------------------------------
insert into storage.buckets (id, name, public)
values ('application-resumes', 'application-resumes', false)
on conflict (id) do update set public = false;

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
