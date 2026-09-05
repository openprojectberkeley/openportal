import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsBoardOrExec } from "@/lib/roles";
import type { CoffeeState } from "@/components/applicant-indicators";

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

  // Recruiting indicators (coffee-chat + info-session status) are visible only to
  // application managers — board/exec/PMs. Uses the *effective* access levels so
  // an exec "viewing as member" (sim cookie) correctly loses them. Non-managers
  // never receive these keys, so the client can't surface what it never sees.
  const isManager = accessIsBoardOrExec(await getEffectiveAccessLevels(supabase));
  let recruiting:
    | { coffee_chat: CoffeeState; infosession_attended: boolean; submitted_application: boolean }
    | null = null;
  if (isManager) {
    // The submitted-application check is scoped to the current cycle, so resolve
    // the period first (returns the open period, else the most recent).
    const { data: periodId } = await supabase.rpc("current_application_period");
    const [{ data: chats }, { data: info }, { data: apps }] = await Promise.all([
      // A booked chat has applicant_id set; `complete` marks it done. Open
      // (unbooked) slots have a null applicant_id and won't match.
      supabase.from("coffee_chats").select("complete").eq("applicant_id", userId),
      // Attendance is recorded under applicant_id or member_id depending on
      // whether they were a member at the time; both are auth user ids.
      supabase
        .from("infosesh_attendance")
        .select("id")
        .or(`applicant_id.eq.${userId},member_id.eq.${userId}`),
      // A submitted (non-draft) application in the current period. Skip when
      // there's no period yet (feeding an empty string to a uuid column errors).
      periodId
        ? supabase
            .from("applications")
            .select("status")
            .eq("applicant_id", userId)
            .eq("period_id", periodId)
            .neq("status", "draft")
            .limit(1)
        : Promise.resolve({ data: [] as { status: string }[] }),
    ]);
    const coffee_chat: CoffeeState = (chats ?? []).some((c) => c.complete)
      ? "done"
      : (chats ?? []).length > 0
        ? "booked"
        : "none";
    recruiting = {
      coffee_chat,
      infosession_attended: (info ?? []).length > 0,
      submitted_application: (apps ?? []).length > 0,
    };
  }

  return NextResponse.json({ ...publicMember, roles, projects, ...recruiting });
}
