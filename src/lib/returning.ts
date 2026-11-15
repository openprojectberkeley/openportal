// "Returning" = was a member before this application period opened.
//
// members.status is today's state, so it can't answer that: everyone accepted
// this cycle is `active` now and would read as returning. Instead someone is
// returning for a period when any of these hold:
//   1. they were accepted in an earlier period (by start date);
//   2. they joined a project team (project_members) before the period started;
//   3. they're a member today (active/inactive) and were NOT accepted in this
//      period or a later one -- members who predate the portal or were placed
//      outside the application flow.
// Analytics (use-recruiting-analytics.ts) uses the same rule.
//
// The database's is_returning_member() (RLS, accept_application's Studio
// guard) still reads current status; it needs a migration to match.

import type { createClient } from "@/lib/supabase/client";
import { selectInChunks } from "@/lib/postgrest-chunk";
import { isReturningMember, type MemberStatus } from "@/lib/member-status";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

export async function fetchReturningForPeriod(
  supabase: SupabaseBrowserClient,
  userIds: string[],
  periodId: string | null | undefined,
): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Set<string>();
  if (!ids.length) return out;

  const [{ data: periods }, members, accepted, teams] = await Promise.all([
    supabase.from("application_periods").select("id, starts_at"),
    selectInChunks(ids, (chunk) => supabase.from("members").select("user_id, status").in("user_id", chunk)),
    selectInChunks(ids, (chunk) =>
      supabase.from("applications").select("applicant_id, period_id").eq("status", "accepted").in("applicant_id", chunk),
    ),
    selectInChunks(ids, (chunk) => supabase.from("project_members").select("user_id, created_at").in("user_id", chunk)),
  ]);

  const startOf = new Map(((periods ?? []) as { id: string; starts_at: string }[]).map((p) => [p.id, p.starts_at]));
  const periodStart = periodId ? startOf.get(periodId) ?? null : null;

  // Without a period there is nothing to be "before": fall back to status.
  if (!periodStart) {
    for (const m of members as { user_id: string; status: MemberStatus | null }[]) {
      if (isReturningMember(m.status)) out.add(m.user_id);
    }
    return out;
  }

  const acceptedThisOrLater = new Set<string>();
  for (const a of accepted as { applicant_id: string; period_id: string }[]) {
    const start = startOf.get(a.period_id);
    if (!start) continue;
    if (start < periodStart) out.add(a.applicant_id);
    else acceptedThisOrLater.add(a.applicant_id);
  }
  for (const t of teams as { user_id: string; created_at: string | null }[]) {
    if (t.created_at && t.created_at < periodStart) out.add(t.user_id);
  }
  for (const m of members as { user_id: string; status: MemberStatus | null }[]) {
    if (isReturningMember(m.status) && !acceptedThisOrLater.has(m.user_id)) out.add(m.user_id);
  }
  return out;
}
