import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Read-only public profile of a single member. Any authenticated member may view
// another member's profile (used by the click-to-open profile modal), so this
// route only checks that the requester is signed in — no exec gate.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: member }, { data: memberRoles }] = await Promise.all([
    supabase
      .from("members")
      .select(
        "user_id, preferred_firstname, lastname, email, major, grad_year, phone, linkedin, github, interests, active",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("members_roles")
      .select("roles(id, role_name)")
      .eq("user_id", userId),
  ]);

  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const roles = (memberRoles ?? [])
    .map((mr) => mr.roles as unknown as { id: string; role_name: string } | null)
    .filter((r): r is { id: string; role_name: string } => Boolean(r));

  return NextResponse.json({ ...member, roles });
}
