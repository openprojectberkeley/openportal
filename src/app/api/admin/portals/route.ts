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

  const [{ data: portals }, { data: portalMembers }, { data: portalRoles }] = await Promise.all([
    supabase
      .from("portals")
      .select("id, name, description, icon, color")
      .order("name"),
    supabase
      .from("portal_members")
      .select("portal_id, user_id, is_admin, members(user_id, preferred_firstname, lastname)"),
    supabase
      .from("portal_roles")
      .select("portal_id, role_id, is_admin, roles(id, role_name)"),
  ]);

  const membersMap = new Map<string, { user_id: string; name: string; is_admin: boolean }[]>();
  for (const pm of portalMembers ?? []) {
    if (!membersMap.has(pm.portal_id)) membersMap.set(pm.portal_id, []);
    const member = pm.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
    if (member) {
      const name = [member.preferred_firstname, member.lastname].filter(Boolean).join(" ") || "—";
      membersMap.get(pm.portal_id)!.push({ user_id: member.user_id, name, is_admin: pm.is_admin });
    }
  }

  const rolesMap = new Map<string, { id: string; role_name: string; is_admin: boolean }[]>();
  for (const pr of portalRoles ?? []) {
    if (!rolesMap.has(pr.portal_id)) rolesMap.set(pr.portal_id, []);
    const role = pr.roles as unknown as { id: string; role_name: string } | null;
    if (role) rolesMap.get(pr.portal_id)!.push({ ...role, is_admin: pr.is_admin });
  }

  const result = (portals ?? []).map((p) => ({
    ...p,
    members: membersMap.get(p.id) ?? [],
    roles: rolesMap.get(p.id) ?? [],
  }));

  return NextResponse.json(result);
}
