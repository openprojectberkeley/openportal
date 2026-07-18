import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsExec } from "@/lib/roles";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Honors the VP Tech "view as" simulation cookie.
  const accessLevels = await getEffectiveAccessLevels(supabase);
  if (!accessIsExec(accessLevels)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ data: projects }, { data: projectMembers }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, client, description")
      .order("name"),
    supabase
      .from("project_members")
      .select("project_id, user_id, is_pm, members(user_id, preferred_firstname, lastname)"),
  ]);

  const membersMap = new Map<string, { user_id: string; name: string; is_pm: boolean }[]>();
  for (const pm of projectMembers ?? []) {
    if (!membersMap.has(pm.project_id)) membersMap.set(pm.project_id, []);
    const member = pm.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
    if (member) {
      const name = [member.preferred_firstname, member.lastname].filter(Boolean).join(" ") || "—";
      membersMap.get(pm.project_id)!.push({ user_id: member.user_id, name, is_pm: pm.is_pm });
    }
  }

  const result = (projects ?? []).map((p) => ({
    ...p,
    members: membersMap.get(p.id) ?? [],
  }));

  return NextResponse.json(result);
}
