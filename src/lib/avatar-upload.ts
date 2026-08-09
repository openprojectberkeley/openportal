import type { SupabaseClient } from "@supabase/supabase-js";

// Uploads a member's avatar Blob directly to Supabase Storage (browser -> Storage
// under the signed-in user's RLS; no proxy) and returns a cache-busted public
// URL to persist on `members.avatar_url`.

export const AVATAR_BUCKET = "avatars";

// Stable object path per user. Re-uploads overwrite the same object (upsert),
// so the public URL is stable — we defeat browser caching with the `?v=` query
// param the returned URL carries.
export function avatarObjectPath(userId: string): string {
  return `${userId}/avatar.jpg`;
}

/**
 * Upload the 128x128 JPEG blob for `userId` and return its public URL with a
 * fresh `?v=` cache-buster.
 */
export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  blob: Blob,
): Promise<string> {
  const path = avatarObjectPath(userId);

  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);

  return `${publicUrl}?v=${Date.now()}`;
}
