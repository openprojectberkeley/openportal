// One definition of "not drafted", shared by the board's button and list, the
// draft manager's counter and analytics, so they can never disagree:
//
//   a draft-eligible application (submitted or accepted, this period)
//   with no CONFIRMED pick on any project (staged-only still counts as not
//   drafted), that hasn't been placed on a team outside the draft (accepted
//   onto a project AND holding a non-PM project_members row for it).

import type { createClient } from "@/lib/supabase/client";
import { selectInChunks } from "@/lib/postgrest-chunk";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

export const DRAFT_ELIGIBLE = ["submitted", "accepted"] as const;

export type DraftApp = {
  id: string;
  status: string;
  applicant_id: string | null;
  accepted_project_id: string | null;
};

/** Pure: which of `apps` are not drafted, given confirmed picks and memberships. */
export function undraftedIds(
  apps: DraftApp[],
  confirmedAppIds: Set<string>,
  // `${user_id}:${project_id}` for non-PM project_members rows.
  memberKeys: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const a of apps) {
    if (!(DRAFT_ELIGIBLE as readonly string[]).includes(a.status)) continue;
    if (confirmedAppIds.has(a.id)) continue;
    const placed = !!a.applicant_id && !!a.accepted_project_id && memberKeys.has(`${a.applicant_id}:${a.accepted_project_id}`);
    if (placed) continue;
    out.add(a.id);
  }
  return out;
}

/** Eligible apps, confirmed picks and memberships for a period, then `undraftedIds`. */
export async function fetchDraftStatus(supabase: SupabaseBrowserClient, periodId: string) {
  const [{ data: appData }, { data: roundData }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, status, applicant_id, accepted_project_id")
      .eq("period_id", periodId)
      .in("status", [...DRAFT_ELIGIBLE]),
    supabase
      .from("draft_rounds")
      .select("draft_round_projects(submitted_at, draft_picks(application_id))")
      .eq("period_id", periodId),
  ]);
  const apps = (appData ?? []) as DraftApp[];
  const confirmed = new Set<string>();
  for (const r of (roundData ?? []) as { draft_round_projects: { submitted_at: string | null; draft_picks: { application_id: string }[] }[] }[]) {
    for (const rp of r.draft_round_projects ?? []) {
      if (!rp.submitted_at) continue;
      for (const p of rp.draft_picks ?? []) confirmed.add(p.application_id);
    }
  }
  const accepted = apps.filter((a) => a.applicant_id && a.accepted_project_id);
  const memberKeys = new Set<string>();
  if (accepted.length) {
    const rows = await selectInChunks<{ project_id: string; user_id: string; is_pm: boolean | null }>(
      [...new Set(accepted.map((a) => a.applicant_id!))],
      (chunk) => supabase.from("project_members").select("project_id, user_id, is_pm").in("user_id", chunk),
    );
    for (const pm of rows) if (!pm.is_pm) memberKeys.add(`${pm.user_id}:${pm.project_id}`);
  }
  const undrafted = undraftedIds(apps, confirmed, memberKeys);
  return { eligible: apps.length, confirmed, memberKeys, apps, undrafted };
}
