import type { SupabaseClient } from "@supabase/supabase-js";

// Uploads a portal's icon Blob directly to Supabase Storage (browser -> Storage
// under the caller's RLS; the write is gated by is_portal_admin, no proxy) and
// returns a cache-busted public URL to persist on `portals.icon_url`.

export const PORTAL_ICON_BUCKET = "portals";

// Stable object path per portal. Re-uploads overwrite the same object (upsert),
// so the public URL is stable — we defeat browser caching with the `?v=` query
// param the returned URL carries.
export function portalIconObjectPath(portalId: string): string {
  return `${portalId}/icon.jpg`;
}

/**
 * Upload the 512x512 JPEG blob for `portalId` and return its public URL with a
 * fresh `?v=` cache-buster.
 */
export async function uploadPortalIcon(
  supabase: SupabaseClient,
  portalId: string,
  blob: Blob,
): Promise<string> {
  const path = portalIconObjectPath(portalId);

  const { error } = await supabase.storage.from(PORTAL_ICON_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(PORTAL_ICON_BUCKET).getPublicUrl(path);

  return `${publicUrl}?v=${Date.now()}`;
}
