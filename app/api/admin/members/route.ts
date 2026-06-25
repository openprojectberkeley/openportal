import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: roleData } = await supabase
    .from("members_roles")
    .select("roles(access_level)")
    .eq("user_id", user.id);

  const isExec = (roleData ?? []).some((r: any) => r.roles?.access_level === "exec");
  if (!isExec) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
