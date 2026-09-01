import type { SupabaseClient } from "@supabase/supabase-js";

// Uploads an applicant's resume directly to the private `application-resumes`
// Supabase Storage bucket (browser -> Storage under the signed-in user's RLS).
// One resume per person, ever: a single object at `{user_id}/resume.<ext>` that
// every new upload replaces. Read back by the owner and by board/exec reviewers
// through short-lived signed URLs. The reference lives on `members.resume_path`.

export const RESUME_BUCKET = "application-resumes";

// 500 KB cap.
export const MAX_RESUME_BYTES = 500 * 1024;

const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx"] as const;

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function resumeObjectPath(userId: string, ext: string): string {
  return `${userId}/resume.${ext}`;
}

/**
 * Upload `file` as `userId`'s single resume. Validates type + size, removes any
 * previously stored resume for the user first (so a format change can't leave
 * two), and returns the stored object path + original filename to persist on
 * `members.resume_path` / `members.resume_filename`. Throws a user-facing
 * message on a bad file or a storage error.
 */
export async function uploadResume(
  supabase: SupabaseClient,
  userId: string,
  file: File,
): Promise<{ path: string; filename: string }> {
  const ext = fileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new Error("Please upload a PDF or Word document (.pdf, .doc, .docx).");
  }
  if (file.size > MAX_RESUME_BYTES) {
    throw new Error("That file is too large (max 500 KB).");
  }

  // Clear any existing resume for this user so exactly one object remains.
  const { data: existing } = await supabase.storage.from(RESUME_BUCKET).list(userId);
  if (existing?.length) {
    await supabase.storage.from(RESUME_BUCKET).remove(existing.map((o) => `${userId}/${o.name}`));
  }

  const path = resumeObjectPath(userId, ext);
  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
    cacheControl: "3600",
  });
  if (error) throw error;

  return { path, filename: file.name };
}

/** Remove a stored resume object. */
export async function deleteResume(supabase: SupabaseClient, path: string): Promise<void> {
  const { error } = await supabase.storage.from(RESUME_BUCKET).remove([path]);
  if (error) throw error;
}

/**
 * Mint a short-lived signed URL to view a stored resume. Works for the owner and
 * for board/exec (per the bucket's read policy). Returns null on failure.
 */
export async function resumeSignedUrl(
  supabase: SupabaseClient,
  path: string,
  expiresInSeconds = 60,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(RESUME_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
