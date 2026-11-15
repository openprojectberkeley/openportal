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
    // Light: just who's in and who's admin, for the row's count and admin
    // names. The full roster loads on expand (/api/admin/portals/[id]/members).
    supabase.from("portal_members").select("portal_id, user_id, is_admin"),
    supabase
      .from("portal_roles")
      .select("portal_id, role_id, is_admin, roles(id, role_name)"),
  ]);

  const countMap = new Map<string, number>();
  const adminIdsMap = new Map<string, string[]>();
  for (const pm of portalMembers ?? []) {
    countMap.set(pm.portal_id, (countMap.get(pm.portal_id) ?? 0) + 1);
    if (pm.is_admin) adminIdsMap.set(pm.portal_id, [...(adminIdsMap.get(pm.portal_id) ?? []), pm.user_id]);
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
      members: null,
      member_count: countMap.get(p.id) ?? 0,
      admin_ids: adminIdsMap.get(p.id) ?? [],
      roles: rolesMap.get(p.id) ?? [],
    };
  });

  return NextResponse.json(result);
}
