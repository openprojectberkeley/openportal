import type { SupabaseClient } from "@supabase/supabase-js";
import { ICON_EXTENSIONS, imageFormat } from "@/lib/avatar-image";

// Shared icon upload for the three entity buckets (portals, projects, families).
// They differ only in bucket name and which RLS policy gates the write, so the
// path convention, format handling and cache-busting live here once.

/**
 * Stable object path per entity, now carrying the real format. The extension
 * varies because a logo with transparency is stored as WebP (or PNG where WebP
 * can't be encoded) while a photo stays JPEG — see getCroppedSquareImage.
 */
export function iconObjectPath(id: string, ext: string): string {
  return `${id}/icon.${ext}`;
}

/**
 * Upload `blob` as the icon for `id` and return its public URL with a fresh
 * `?v=` cache-buster.
 *
 * Re-uploading the same format overwrites in place (upsert), so the URL is
 * stable and only the cache-buster changes. Changing format writes a *different*
 * path, which would leave the previous object behind forever — upsert can't
 * overwrite a name it isn't writing — so the other extensions are removed first.
 * Removing a key that doesn't exist is a no-op, so this is safe on every upload.
 */
export async function uploadEntityIcon(
  supabase: SupabaseClient,
  bucket: string,
  id: string,
  blob: Blob,
): Promise<string> {
  const { ext, contentType } = imageFormat(blob);
  const path = iconObjectPath(id, ext);

  const stale = ICON_EXTENSIONS.filter((e) => e !== ext).map((e) => iconObjectPath(id, e));
  // Best-effort: a failed cleanup costs an orphaned object, which shouldn't
  // block the upload the user is actually waiting on.
  await supabase.storage.from(bucket).remove(stale).catch(() => {});

  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType,
    cacheControl: "3600",
  });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);

  return `${publicUrl}?v=${Date.now()}`;
}
