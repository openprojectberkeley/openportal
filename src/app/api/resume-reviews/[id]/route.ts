import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RESUME_REVIEW_BUCKET } from "@/lib/resume-upload";

// Withdraws the caller's pending request. The RPC checks ownership under their
// session; only then does the service role remove the frozen copy.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { data: filePath, error } = await supabase.rpc("withdraw_resume_review", { p_review_id: id });
  if (error) return NextResponse.json({ error: "That request can't be withdrawn." }, { status: 409 });

  if (filePath) {
    const { error: removeError } = await createAdminClient().storage.from(RESUME_REVIEW_BUCKET).remove([filePath]);
    if (removeError) console.error("Couldn't delete withdrawn resume review file", removeError.message);
  }
  return NextResponse.json({ id });
}
