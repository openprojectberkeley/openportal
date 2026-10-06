-- Custom image icons for families.
--
-- 0103 shipped `families.icon_url` but no bucket to put an image in, so the
-- IconPicker's "Upload image" path had nowhere to write: with no id prop the
-- picker runs in deferred mode and hands the cropped blob back through
-- `onImageBlob`, which the families panel wasn't passing. Picking an image
-- cropped it and then silently dropped it. This adds the missing half.
--
-- Mirrors the `projects` bucket from 0031 and the `portals` bucket from 0015 —
-- public read (the URL is embedded in an <img> on pages anyone signed in can
-- see), writes gated on the folder name, which is the family id.
--
-- The gate is `is_exec()` rather than 0031's `can_edit_project(...)`: a family
-- has no PMs, and managing families is already exec-only everywhere else
-- (0103's families_insert/update/delete policies). Unlike the project bucket
-- there is no per-row ownership to consult, so the folder uuid doesn't need to
-- resolve to anything — but the path shape is kept identical (`{id}/icon.jpg`)
-- so family-icon-upload.ts is a straight copy of project-icon-upload.ts.

insert into storage.buckets (id, name, public)
values ('families', 'families', true)
on conflict (id) do update set public = true;

drop policy if exists "families_icon_read" on storage.objects;
create policy "families_icon_read"
on storage.objects
for select
to public
using ( bucket_id = 'families' );

drop policy if exists "families_icon_insert" on storage.objects;
create policy "families_icon_insert"
on storage.objects
for insert
to authenticated
with check ( bucket_id = 'families' and (select public.is_exec()) );

drop policy if exists "families_icon_update" on storage.objects;
create policy "families_icon_update"
on storage.objects
for update
to authenticated
using      ( bucket_id = 'families' and (select public.is_exec()) )
with check ( bucket_id = 'families' and (select public.is_exec()) );

drop policy if exists "families_icon_delete" on storage.objects;
create policy "families_icon_delete"
on storage.objects
for delete
to authenticated
using ( bucket_id = 'families' and (select public.is_exec()) );
