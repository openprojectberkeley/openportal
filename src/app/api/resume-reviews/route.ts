import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { looksLikePdf, parseReviewRequest, UPLOAD_A_PDF } from "@/lib/resume-review-request";
import { isPdfPath, RESUME_BUCKET, RESUME_REVIEW_BUCKET } from "@/lib/resume-upload";

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const ALREADY_WAITING = "You already have a review request waiting.";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

// Creates a review request with its own frozen PDF. The caller is authenticated
// and their resume is read under their own session; the service role is used
// only for the two writes browsers aren't allowed to make.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Please sign in again.", 401);

  const fields = parseReviewRequest(await request.json().catch(() => null));
  if (!fields) return fail("Check your answers and try again.", 400);

  const [{ data: member }, { data: waiting }] = await Promise.all([
    supabase.from("members").select("resume_path, resume_filename").eq("user_id", user.id).maybeSingle(),
    supabase.from("resume_reviews").select("id").eq("requester_id", user.id).eq("status", "pending").maybeSingle(),
  ]);
  if (waiting) return fail(ALREADY_WAITING, 409);
  if (!member?.resume_path) return fail("Upload a resume first.", 400);

  const { data: source, error: downloadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .download(member.resume_path);
  if (downloadError || !source) return fail("Couldn't read your resume. Try uploading it again.", 500);

  if (!isPdfPath(member.resume_path)) return fail(UPLOAD_A_PDF, 422);
  const pdf = new Uint8Array(await source.arrayBuffer());
  if (!looksLikePdf(pdf)) return fail(UPLOAD_A_PDF, 422);
  if (pdf.byteLength > MAX_PDF_BYTES) return fail("That resume is too large to review.", 413);

  const admin = createAdminClient();
  const id = randomUUID();
  const filePath = `${user.id}/${id}.pdf`;

  const { error: uploadError } = await admin.storage
    .from(RESUME_REVIEW_BUCKET)
    .upload(filePath, pdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) return fail("Couldn't submit that request.", 500);

  const { error: insertError } = await admin.from("resume_reviews").insert({
    id,
    requester_id: user.id,
    resume_path: member.resume_path,
    resume_filename: member.resume_filename,
    file_path: filePath,
    target_roles: fields.targetRoles,
    needed_by: fields.neededBy,
  });
  if (insertError) {
    await admin.storage.from(RESUME_REVIEW_BUCKET).remove([filePath]);
    return insertError.code === "23505" ? fail(ALREADY_WAITING, 409) : fail("Couldn't submit that request.", 500);
  }

  return NextResponse.json({ id }, { status: 201 });
}
