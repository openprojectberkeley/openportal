import { NextResponse } from "next/server";
import { requireExec } from "@/lib/admin-route";

// One member's details, fetched when their admin row is expanded.
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireExec();
  if ("response" in gate) return gate.response;
  const { userId } = await params;
  const { data, error } = await gate.supabase
    .from("members")
    .select("major, grad_year, phone, linkedin, github")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? {});
}
