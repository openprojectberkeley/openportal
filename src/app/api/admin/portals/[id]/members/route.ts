import { NextResponse } from "next/server";
import { fullName, requireExec } from "@/lib/admin-route";

// A portal's roster, fetched when its admin row is expanded. `managed` rows
// are project-derived and `is_owner` marks the creator; both are locked.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireExec();
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const { data, error } = await gate.supabase
    .from("portal_members")
    .select("user_id, is_admin, managed, is_owner, members(user_id, preferred_firstname, lastname)")
    .eq("portal_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []).flatMap((pm) => {
    const m = pm.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
    if (!m) return [];
    return [{ user_id: m.user_id, name: fullName(m), is_admin: pm.is_admin, locked: pm.managed || pm.is_owner, owner: pm.is_owner }];
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(rows);
}
