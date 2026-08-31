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

  const [{ data: portals }, { data: portalMembers }, { data: portalRoles }] = await Promise.all([
    supabase
      .from("portals")
      .select("id, name, description, icon, icon_url, color, type, project_id, projects(name)")
      .order("name"),
    // `managed` rows are project-derived, `is_owner` marks the creator — both
    // are locked (edited only by triggers, never from the UI).
    supabase
      .from("portal_members")
      .select("portal_id, user_id, is_admin, managed, is_owner, members(user_id, preferred_firstname, lastname)"),
    supabase
      .from("portal_roles")
      .select("portal_id, role_id, is_admin, roles(id, role_name)"),
  ]);

  const membersMap = new Map<string, { user_id: string; name: string; is_admin: boolean; locked: boolean; owner: boolean }[]>();
  for (const pm of portalMembers ?? []) {
    if (!membersMap.has(pm.portal_id)) membersMap.set(pm.portal_id, []);
    const member = pm.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
    if (member) {
      const name = [member.preferred_firstname, member.lastname].filter(Boolean).join(" ") || "—";
      membersMap.get(pm.portal_id)!.push({
        user_id: member.user_id,
        name,
        is_admin: pm.is_admin,
        locked: pm.managed || pm.is_owner,
        owner: pm.is_owner,
      });
    }
  }

  const rolesMap = new Map<string, { id: string; role_name: string; is_admin: boolean }[]>();
  for (const pr of portalRoles ?? []) {
    if (!rolesMap.has(pr.portal_id)) rolesMap.set(pr.portal_id, []);
    const role = pr.roles as unknown as { id: string; role_name: string } | null;
    if (role) rolesMap.get(pr.portal_id)!.push({ ...role, is_admin: pr.is_admin });
  }

  const result = (portals ?? []).map((p) => {
    const project = p.projects as unknown as { name: string } | null;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      icon_url: p.icon_url,
      color: p.color,
      type: p.type,
      project_id: p.project_id,
      project_name: project?.name ?? null,
      members: membersMap.get(p.id) ?? [],
      roles: rolesMap.get(p.id) ?? [],
    };
  });

  return NextResponse.json(result);
}
