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

  const [{ data: members }, { data: memberRoles }] = await Promise.all([
    supabase
      .from("members")
      .select("user_id, preferred_firstname, lastname, major, grad_year, phone, linkedin, github"),
    supabase
      .from("members_roles")
      .select("user_id, roles(id, role_name)"),
  ]);

  const rolesMap = new Map<string, { id: string; role_name: string }[]>();
  for (const mr of memberRoles ?? []) {
    if (!rolesMap.has(mr.user_id)) rolesMap.set(mr.user_id, []);
    if (mr.roles) rolesMap.get(mr.user_id)!.push(mr.roles as any);
  }

  const result = (members ?? []).map((m) => ({
    ...m,
    roles: rolesMap.get(m.user_id) ?? [],
  }));

  return NextResponse.json(result);
}
