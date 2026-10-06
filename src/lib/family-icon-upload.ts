import type { SupabaseClient } from "@supabase/supabase-js";

// Uploads a family's icon Blob directly to Supabase Storage (browser -> Storage
// under the caller's RLS; the write is gated by is_exec(), no proxy) and returns
// a cache-busted public URL to persist on `families.icon_url`. Mirrors
// project-icon-upload.ts; the bucket and its policies come from 0101.

export const FAMILY_ICON_BUCKET = "families";

// Stable object path per family. Re-uploads overwrite the same object (upsert),
// so the public URL is stable — we defeat browser caching with the `?v=` query
// param the returned URL carries.
export function familyIconObjectPath(familyId: string): string {
  return `${familyId}/icon.jpg`;
}

/**
 * Upload the 512x512 JPEG blob for `familyId` and return its public URL with a
 * fresh `?v=` cache-buster.
 */
export async function uploadFamilyIcon(
  supabase: SupabaseClient,
  familyId: string,
  blob: Blob,
): Promise<string> {
  const path = familyIconObjectPath(familyId);

  const { error } = await supabase.storage.from(FAMILY_ICON_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(FAMILY_ICON_BUCKET).getPublicUrl(path);

  return `${publicUrl}?v=${Date.now()}`;
}
