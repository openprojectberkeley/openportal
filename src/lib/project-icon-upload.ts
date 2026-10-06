import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadEntityIcon } from "@/lib/icon-upload";

// Uploads a project's icon Blob directly to Supabase Storage (browser -> Storage
// under the caller's RLS; the write is gated by can_edit_project, no proxy) and
// returns a cache-busted public URL to persist on `projects.icon_url`. The
// project's portal derives its icon from here.

export const PROJECT_ICON_BUCKET = "projects";

/** Upload the icon blob for `projectId` and return its cache-busted public URL. */
export async function uploadProjectIcon(
  supabase: SupabaseClient,
  projectId: string,
  blob: Blob,
): Promise<string> {
  return uploadEntityIcon(supabase, PROJECT_ICON_BUCKET, projectId, blob);
}
