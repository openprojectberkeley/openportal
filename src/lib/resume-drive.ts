import type { SupabaseClient } from "@supabase/supabase-js";

// Uploads an applicant's resume to a shared Google Drive folder via the
// `upload-resume-drive` edge function (which authenticates with a service
// account and records a link on the application row). Replaces the old
// Supabase-Storage resume upload.

export const MAX_RESUME_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx"] as const;

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Upload `file` for the given application period. Returns the Drive file id,
 *  a viewable link, and the original filename. Throws with a user-facing
 *  message on a bad file or a function/Drive error. */
export async function uploadResumeToDrive(
  supabase: SupabaseClient,
  periodId: string,
  file: File,
): Promise<{ fileId: string; url: string; filename: string }> {
  if (!ALLOWED_EXTENSIONS.includes(fileExtension(file.name) as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new Error("Please upload a PDF or Word document (.pdf, .doc, .docx).");
  }
  if (file.size > MAX_RESUME_BYTES) {
    throw new Error("That file is too large (max 8 MB).");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("period_id", periodId);

  const { data, error } = await supabase.functions.invoke("upload-resume-drive", { body: form });
  if (error) throw new Error(error.message || "Upload failed.");
  if (data?.error) throw new Error(data.error);
  return data as { fileId: string; url: string; filename: string };
}

/** Delete the applicant's uploaded resume from Drive and clear the link. */
export async function deleteResumeFromDrive(supabase: SupabaseClient, periodId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("upload-resume-drive", {
    body: { action: "delete", period_id: periodId },
  });
  if (error) throw new Error(error.message || "Couldn't remove the resume.");
}
