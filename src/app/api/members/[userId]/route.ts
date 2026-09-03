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

  const [{ data: member }, { data: memberRoles }, { data: memberProjects }] = await Promise.all([
    supabase
      .from("members")
      .select(
        "user_id, preferred_firstname, lastname, email, major, grad_year, phone, linkedin, github, interests, pronouns, pronouns_public, status, avatar_url",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("members_roles")
      .select("roles(id, role_name)")
      .eq("user_id", userId),
    supabase
      .from("project_members")
      .select("is_pm, projects(id, name, color)")
      .eq("user_id", userId),
  ]);

  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Enforce the per-member "visible to everyone" toggle server-side: strip
  // pronouns for other viewers when the owner has made them private. The owner
  // always sees their own value. `pronouns_public` is internal — never returned.
  const { pronouns_public, pronouns, ...rest } = member;
  const visiblePronouns = pronouns_public || user.id === userId ? pronouns ?? null : null;
  const publicMember = { ...rest, pronouns: visiblePronouns };

  const roles = (memberRoles ?? [])
    .map((mr) => mr.roles as unknown as { id: string; role_name: string } | null)
    .filter((r): r is { id: string; role_name: string } => Boolean(r));

  const projects = (memberProjects ?? [])
    .map((pm) => {
      const project = pm.projects as unknown as { id: string; name: string; color: string | null } | null;
      return project
        ? { id: project.id, name: project.name, is_pm: Boolean(pm.is_pm), color: project.color ?? null }
        : null;
    })
    .filter((p): p is { id: string; name: string; is_pm: boolean; color: string | null } => Boolean(p));

  return NextResponse.json({ ...publicMember, roles, projects });
}
