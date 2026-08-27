import type { SupabaseClient } from "@supabase/supabase-js";

// Uploads a project's icon Blob directly to Supabase Storage (browser -> Storage
// under the caller's RLS; the write is gated by can_edit_project, no proxy) and
// returns a cache-busted public URL to persist on `projects.icon_url`. Mirrors
// portal-icon-upload.ts — the project's portal derives its icon from here.

export const PROJECT_ICON_BUCKET = "projects";

// Stable object path per project. Re-uploads overwrite the same object (upsert),
// so the public URL is stable — we defeat browser caching with the `?v=` query
// param the returned URL carries.
export function projectIconObjectPath(projectId: string): string {
  return `${projectId}/icon.jpg`;
}

/**
 * Upload the 512x512 JPEG blob for `projectId` and return its public URL with a
 * fresh `?v=` cache-buster.
 */
export async function uploadProjectIcon(
  supabase: SupabaseClient,
  projectId: string,
  blob: Blob,
): Promise<string> {
  const path = projectIconObjectPath(projectId);

  const { error } = await supabase.storage.from(PROJECT_ICON_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(PROJECT_ICON_BUCKET).getPublicUrl(path);

  return `${publicUrl}?v=${Date.now()}`;
}
