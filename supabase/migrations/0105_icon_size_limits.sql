-- A hard ceiling on entity icon uploads.
--
-- Icons are produced entirely in the browser (avatar-image.ts crops to a square
-- canvas and encodes it), so until now nothing server-side bounded what could
-- land in these buckets — a client that skipped the cropper could upload
-- anything up to Supabase's global limit.
--
-- 256 kB is generous for what the cropper actually emits at 256x256: a WebP
-- logo with alpha lands around 5-15 kB, a JPEG photo around 20-40 kB, and even
-- the PNG fallback path (browsers that can't encode WebP) stays well under.
--
-- Deliberately not setting `allowed_mime_types`: the encoder emits exactly
-- webp/png/jpeg today, but pinning the list turns any future format change into
-- a silent upload failure, and the size limit already caps the abuse case.
--
-- Idempotent: re-running just re-applies the same value.

update storage.buckets
set file_size_limit = 262144  -- 256 kB
where id in ('portals', 'projects', 'families');
