import type { SupabaseClient } from "@supabase/supabase-js";

// Uploads an applicant's resume directly to the private `application-resumes`
// Supabase Storage bucket (browser -> Storage under the signed-in user's RLS).
// One resume per person, ever: a single object at `{user_id}/resume.<ext>` that
// every new upload replaces. Read back by the owner and by board/exec reviewers
// through short-lived signed URLs. The reference lives on `members.resume_path`.

export const RESUME_BUCKET = "application-resumes";

// Frozen PDF copies, one per review request (`{requester_id}/{review_id}.pdf`).
// Written only by /api/resume-reviews, so notes always match the file they were
// placed on, even after the person uploads a new resume.
export const RESUME_REVIEW_BUCKET = "resume-review-files";

export type ResumeFile = { bucket: string; path: string; filename: string };

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

export function isPdfPath(path: string): boolean {
  return fileExtension(path) === "pdf";
}

/** The name a review's frozen PDF downloads under: the original, ending in .pdf. */
export function pdfFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return `${dot > 0 ? filename.slice(0, dot) : filename}.pdf`;
}

/** The file a review is about: its frozen copy, or the original for older requests. */
export function resumeReviewFile(review: {
  file_path?: string | null;
  resume_path: string;
  resume_filename: string | null;
}): ResumeFile {
  const filename = review.resume_filename ?? "Resume";
  return review.file_path
    ? { bucket: RESUME_REVIEW_BUCKET, path: review.file_path, filename: pdfFilename(filename) }
    : { bucket: RESUME_BUCKET, path: review.resume_path, filename };
}

/** Fetch a stored resume under the caller's own access. Null on failure. */
export async function fetchResumeBlob(supabase: SupabaseClient, file: ResumeFile): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(file.bucket).download(file.path);
  return error ? null : data;
}

/** Hand a fetched file to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
