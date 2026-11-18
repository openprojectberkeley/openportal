// One-time: gives existing pending and completed resume reviews their frozen PDF.
// Dry run by default, safe to re-run.
//
//   node --env-file=.env scripts/backfill_resume_review_files.mjs
//   node --env-file=.env scripts/backfill_resume_review_files.mjs --apply
//
// A resume replaced after the request is skipped and reported: copying it would
// freeze a different document from the one the person asked to have reviewed.
import { createClient } from "@supabase/supabase-js";

const SOURCE_BUCKET = "application-resumes";
const TARGET_BUCKET = "resume-review-files";
const apply = process.argv.includes("--apply");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: reviews, error } = await admin
  .from("resume_reviews")
  .select("id, requester_id, resume_path, status, created_at")
  .in("status", ["pending", "completed"])
  .is("file_path", null);
if (error) throw error;

const counts = { copied: 0, ready: 0, skipped: 0 };
const skip = (review, reason) => {
  counts.skipped += 1;
  console.log(`skip ${review.id} (${review.status}): ${reason}`);
};

for (const review of reviews) {
  if (!review.resume_path.toLowerCase().endsWith(".pdf")) {
    skip(review, "not a PDF");
    continue;
  }

  const slash = review.resume_path.lastIndexOf("/");
  const folder = review.resume_path.slice(0, slash);
  const name = review.resume_path.slice(slash + 1);
  const { data: objects, error: listError } = await admin.storage.from(SOURCE_BUCKET).list(folder, { search: name });
  const object = objects?.find((o) => o.name === name);
  if (listError || !object) {
    skip(review, "file not found");
    continue;
  }
  if (new Date(object.updated_at) > new Date(review.created_at)) {
    skip(review, "resume was replaced after the request");
    continue;
  }

  if (!apply) {
    counts.ready += 1;
    continue;
  }

  const { data: blob, error: downloadError } = await admin.storage.from(SOURCE_BUCKET).download(review.resume_path);
  if (downloadError) {
    skip(review, "download failed");
    continue;
  }

  const filePath = `${review.requester_id}/${review.id}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(TARGET_BUCKET)
    .upload(filePath, blob, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    skip(review, `upload failed: ${uploadError.message}`);
    continue;
  }

  const { error: updateError } = await admin
    .from("resume_reviews")
    .update({ file_path: filePath })
    .eq("id", review.id)
    .is("file_path", null);
  if (updateError) {
    skip(review, `update failed: ${updateError.message}`);
    continue;
  }
  counts.copied += 1;
}

console.log(apply ? `Copied ${counts.copied}, skipped ${counts.skipped}.` : `Ready ${counts.ready}, skipped ${counts.skipped}. Re-run with --apply to copy.`);
