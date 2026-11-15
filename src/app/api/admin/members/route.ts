import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsExec } from "@/lib/roles";
import { NextResponse, type NextRequest } from "next/server";

const MAX_PAGE_SIZE = 100;

/**
 * Admin member list, one page at a time.
 *
 *   ?page=0&pageSize=50&q=ann&roles=<id>,<id>&status=active,inactive
 *     → { rows, total, all }   (total = after filters, all = unfiltered)
 *   ?names=1
 *     → { names: [{ user_id, name }] }   (every member, for pickers)
 *
 * Filtering runs here rather than in the browser: the client only ever
 * renders one page, which is what keeps the members tab quick.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const namesOnly = params.get("names") === "1";

  // The access check (honors the VP Tech/President "view as" cookie) and the
  // data queries run together; nothing is returned until the check passes,
  // and RLS still scopes the reads.
  const [accessLevels, { data: members, error: membersError }, { data: memberRoles }] = await Promise.all([
    getEffectiveAccessLevels(supabase, user),
    supabase
      .from("members")
      // Light rows: names, status and roles. Contact/academic details load
      // per member on expand (/api/admin/members/[userId]).
      .select(namesOnly ? "user_id, preferred_firstname, lastname" : "user_id, preferred_firstname, lastname, status")
      .order("preferred_firstname", { ascending: true, nullsFirst: false })
      .order("lastname", { ascending: true, nullsFirst: false }),
    namesOnly
      ? Promise.resolve({ data: null })
      : supabase.from("members_roles").select("user_id, roles(id, role_name)"),
  ]);
  if (!accessIsExec(accessLevels)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });

  type Row = { user_id: string; preferred_firstname: string | null; lastname: string | null; status?: string };
  const rows = (members ?? []) as unknown as Row[];
  const nameOf = (m: Row) => [m.preferred_firstname, m.lastname].filter(Boolean).join(" ");

  if (namesOnly) {
    return NextResponse.json({ names: rows.map((m) => ({ user_id: m.user_id, name: nameOf(m) || "—" })) });
  }

  const rolesMap = new Map<string, { id: string; role_name: string }[]>();
  for (const mr of (memberRoles ?? []) as { user_id: string; roles: unknown }[]) {
    if (!rolesMap.has(mr.user_id)) rolesMap.set(mr.user_id, []);
    if (mr.roles) rolesMap.get(mr.user_id)!.push(mr.roles as { id: string; role_name: string });
  }

  const q = (params.get("q") ?? "").trim().toLowerCase();
  const roleIds = new Set((params.get("roles") ?? "").split(",").filter(Boolean));
  const statuses = new Set((params.get("status") ?? "").split(",").filter(Boolean));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 50));

  const filtered = rows.filter((m) => {
    if (q && !nameOf(m).toLowerCase().includes(q)) return false;
    if (statuses.size > 0 && !statuses.has(m.status ?? "")) return false;
    if (roleIds.size > 0 && !(rolesMap.get(m.user_id) ?? []).some((r) => roleIds.has(r.id))) return false;
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount - 1, Math.max(0, Number(params.get("page")) || 0));
  const slice = filtered.slice(page * pageSize, (page + 1) * pageSize).map((m) => ({
    ...m,
    roles: rolesMap.get(m.user_id) ?? [],
  }));

  return NextResponse.json({ rows: slice, total: filtered.length, all: rows.length, page });
}
