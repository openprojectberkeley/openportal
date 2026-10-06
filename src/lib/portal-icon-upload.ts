import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadEntityIcon } from "@/lib/icon-upload";

// Uploads a portal's icon Blob directly to Supabase Storage (browser -> Storage
// under the caller's RLS; the write is gated by is_portal_admin, no proxy) and
// returns a cache-busted public URL to persist on `portals.icon_url`.

export const PORTAL_ICON_BUCKET = "portals";

/** Upload the icon blob for `portalId` and return its cache-busted public URL. */
export async function uploadPortalIcon(
  supabase: SupabaseClient,
  portalId: string,
  blob: Blob,
): Promise<string> {
  return uploadEntityIcon(supabase, PORTAL_ICON_BUCKET, portalId, blob);
}
