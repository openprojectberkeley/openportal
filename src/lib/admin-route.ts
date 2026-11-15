import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsExec } from "@/lib/roles";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Shared gate for /api/admin/* routes: signed in and (effective, i.e.
 * honouring the "view as" simulation) exec. Returns the client to query with,
 * or the response to send back.
 */
export async function requireExec(): Promise<{ supabase: Supabase } | { response: NextResponse }> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const levels = await getEffectiveAccessLevels(supabase, user);
  if (!accessIsExec(levels)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { supabase };
}

export const fullName = (m: { preferred_firstname: string | null; lastname: string | null } | null | undefined) =>
  [m?.preferred_firstname, m?.lastname].filter(Boolean).join(" ") || "—";
