-- Uploadable image icons for portals.
--
-- In addition to the emoji `icon`, a portal can have a 512x512 JPEG image icon.
-- The image is cropped and resized client-side and uploaded straight to Storage
-- (no server proxy). We store the resulting public URL (with a `?v=` cache-bust
-- query param, refreshed on every upload) on the portal row so read sites just
-- drop `icon_url` into an <img src>. When `icon_url` is set it wins; otherwise
-- the emoji `icon` (or the default door) is shown.
--
-- Storage layout: bucket `portals`, one object per portal at `{portal_id}/icon.jpg`.
-- Unlike avatars (keyed by the caller's uid), portal icons aren't owned by a
-- single user — any portal admin may upload. So Storage RLS is gated by
-- `public.is_portal_admin(portal_id)` on the object's first path segment. That
-- function is security-definer + granted to authenticated, and the creator gets
-- a locked owner-admin portal_members row via the after-insert trigger (0014),
-- so create-time uploads pass.

-- 1. Column on the portal row.
alter table public.portals
  add column if not exists icon_url text;

-- 2. Public bucket. Public read means the browser loads images from Storage's
--    CDN via getPublicUrl (no signed URLs, no read proxy). Portal icons are
--    shown to all members of the portal anyway.
insert into storage.buckets (id, name, public)
values ('portals', 'portals', true)
on conflict (id) do update set public = true;

-- 3. Storage RLS on storage.objects, scoped to the `portals` bucket.
--    Writes are allowed only when the caller is an admin of the portal whose id
--    is the object's first path segment (`{portal_id}/icon.jpg`).

-- Read: anyone (public bucket). Explicit for clarity.
drop policy if exists "portals_icon_read" on storage.objects;
create policy "portals_icon_read"
on storage.objects
for select
to public
using ( bucket_id = 'portals' );

drop policy if exists "portals_icon_insert" on storage.objects;
create policy "portals_icon_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'portals'
  and public.is_portal_admin(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "portals_icon_update" on storage.objects;
create policy "portals_icon_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'portals'
  and public.is_portal_admin(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'portals'
  and public.is_portal_admin(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "portals_icon_delete" on storage.objects;
create policy "portals_icon_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'portals'
  and public.is_portal_admin(((storage.foldername(name))[1])::uuid)
);
