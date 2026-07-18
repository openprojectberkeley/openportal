import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsExec } from "@/lib/roles";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Honors the VP Tech "view as" simulation cookie.
  const accessLevels = await getEffectiveAccessLevels(supabase);
  if (!accessIsExec(accessLevels)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const type = new URL(request.url).searchParams.get("type");

  let portalsQuery = supabase
    .from("portals")
    .select("id, type, name, description, metadata")
    .order("name");
  if (type) portalsQuery = portalsQuery.eq("type", type);

  const [{ data: portals }, { data: portalMembers }] = await Promise.all([
    portalsQuery,
    supabase
      .from("portal_members")
      .select("portal_id, user_id, role, members(user_id, preferred_firstname, lastname)"),
  ]);

  const membersMap = new Map<string, { user_id: string; name: string; role: string }[]>();
  for (const pm of portalMembers ?? []) {
    if (!membersMap.has(pm.portal_id)) membersMap.set(pm.portal_id, []);
    const member = pm.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
    if (member) {
      const name = [member.preferred_firstname, member.lastname].filter(Boolean).join(" ") || "—";
      membersMap.get(pm.portal_id)!.push({ user_id: member.user_id, name, role: pm.role });
    }
  }

  const result = (portals ?? []).map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    metadata: (p.metadata ?? {}) as Record<string, unknown>,
    members: membersMap.get(p.id) ?? [],
  }));

  return NextResponse.json(result);
}
