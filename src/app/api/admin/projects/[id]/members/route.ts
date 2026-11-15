import { NextResponse } from "next/server";
import { fullName, requireExec } from "@/lib/admin-route";

// A project's roster, fetched when its admin row is expanded.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireExec();
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const { data, error } = await gate.supabase
    .from("project_members")
    .select("user_id, is_pm, members(user_id, preferred_firstname, lastname)")
    .eq("project_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []).flatMap((pm) => {
    const m = pm.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
    return m ? [{ user_id: m.user_id, name: fullName(m), is_pm: pm.is_pm }] : [];
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(rows);
}
