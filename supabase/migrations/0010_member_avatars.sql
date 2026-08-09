-- Profile pictures for members.
--
-- Each member can set a 128x128 JPEG avatar. The image is cropped and resized
-- client-side and uploaded straight to Storage under the signed-in user's RLS
-- (no server proxy). We store the resulting public URL (with a `?v=` cache-bust
-- query param, refreshed on every upload) on the member row so every read site
-- just drops `avatar_url` into an <img src>.
--
-- Storage layout: bucket `avatars`, one object per user at `{user_id}/avatar.jpg`.
-- Keying the object path by user id keeps the Storage RLS simple: a user may
-- only write within their own top-level folder.

-- 1. Column on the profile row.
alter table public.members
  add column if not exists avatar_url text;

-- 2. Public bucket. Public read means the browser loads images from Storage's
--    CDN via getPublicUrl (no signed URLs, no read proxy). pfps are shown to all
--    signed-in members anyway.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 3. Storage RLS on storage.objects, scoped to the `avatars` bucket.
--    Writes are allowed only when the object's first path segment equals the
--    caller's uid, so a user can only manage `{their-uid}/...`.

-- Read: anyone (public bucket). Explicit for clarity.
drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read"
on storage.objects
for select
to public
using ( bucket_id = 'avatars' );

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
