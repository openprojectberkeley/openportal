import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadEntityIcon } from "@/lib/icon-upload";

// Uploads a family's icon Blob directly to Supabase Storage (browser -> Storage
// under the caller's RLS; the write is gated by is_exec(), no proxy) and returns
// a cache-busted public URL to persist on `families.icon_url`. Bucket and
// policies come from 0104.

export const FAMILY_ICON_BUCKET = "families";

/** Upload the icon blob for `familyId` and return its cache-busted public URL. */
export async function uploadFamilyIcon(
  supabase: SupabaseClient,
  familyId: string,
  blob: Blob,
): Promise<string> {
  return uploadEntityIcon(supabase, FAMILY_ICON_BUCKET, familyId, blob);
}
