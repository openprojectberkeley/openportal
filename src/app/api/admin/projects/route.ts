import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsExec } from "@/lib/roles";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Honors the VP Tech/President "view as" simulation cookie.
  const accessLevels = await getEffectiveAccessLevels(supabase);
  if (!accessIsExec(accessLevels)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ data: projects }, { data: projectMembers }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, client, description, type, difficulty, estimated_members, num_subteams, icon, icon_url, color, family_id")
      .order("name"),
    // Light: counts only. The roster loads on expand (/api/admin/projects/[id]/members).
    supabase.from("project_members").select("project_id"),
  ]);

  const countMap = new Map<string, number>();
  for (const pm of projectMembers ?? []) countMap.set(pm.project_id, (countMap.get(pm.project_id) ?? 0) + 1);

  const result = (projects ?? []).map((p) => ({
    ...p,
    members: null,
    member_count: countMap.get(p.id) ?? 0,
  }));

  return NextResponse.json(result);
}
