// Turns raw application rows into the AppRow shape the applicant cards render.
// Every "who is this applicant, and are they recruiting-valid?" read lives here
// so the per-project applicants list and the cross-project exec board can't
// drift apart: names, returning status, coffee state (plus who with), info
// session attendance, board/exec auto-validity, and which *other* projects have
// shortlisted them.

import type { createClient } from "@/lib/supabase/client";
import type { ReviewStatus } from "@/components/application-review-modal";
import type { Applicant, AppRow } from "@/components/applicant-meta";
import type { WishlistProject } from "@/components/applicant-indicators";
import { coffeeWithByApplicant, type CoffeeState } from "@/lib/coffee-chat-indicator";
import { fetchInfoseshAttendedIds, selectInChunks } from "@/lib/postgrest-chunk";
import { isRecruitingValid } from "@/lib/utils";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

// The columns every caller already has in hand from `applications` itself.
// `rank` is the applicant's ranking for whichever project the caller cares
// about -- 0 when that isn't known yet (the cross-project board fills it in per
// column, since one applicant carries a different rank for each project).
export type BaseAppRow = {
  id: string;
  status: ReviewStatus;
  submitted_at: string | null;
  applicant_id: string | null;
  rank: number;
};

/**
 * Resolves the derived per-applicant fields for `rows` in a handful of chunked
 * queries (never one per row), keyed on `applicant_id` -- the auth user id,
 * which has no FK to `members`, hence the second pass.
 *
 * `excludeWishlistProjectId` drops one project from each row's `wishlistedBy`:
 * the viewer's own project, whose shortlist the card already speaks for.
 */
export async function enrichAppRows(
  supabase: SupabaseBrowserClient,
  rows: BaseAppRow[],
  opts?: { excludeWishlistProjectId?: string | null },
): Promise<AppRow[]> {
  const excludeProjectId = opts?.excludeWishlistProjectId ?? null;
  const ids = [...new Set(rows.map((r) => r.applicant_id).filter((id): id is string => !!id))];
  const appIds = rows.map((r) => r.id);

  const byId: Record<string, Applicant> = {};
  const returningById: Record<string, boolean> = {};
  const coffeeById: Record<string, CoffeeState> = {};
  let coffeeWithById: Record<string, string[]> = {};
  const attendedInfo = new Set<string>();
  // Board/exec applicants are auto-valid (same as application sheet / 0067).
  const boardExecIds = new Set<string>();
  // Other projects' wishlists for these applicants.
  const wishlistedById: Record<string, WishlistProject[]> = {};

  if (ids.length) {
    // Chunk large `.in()` lists; infosesh uses dual `.in()` (not doubled OR).
    const [mem, chats, infoAttended, roleRows, wishRows] = await Promise.all([
      selectInChunks(ids, (chunk) =>
        supabase.from("members").select("user_id, preferred_firstname, lastname, status").in("user_id", chunk),
      ),
      // A booked chat has applicant_id set; `complete` marks it done. Open
      // (unbooked) slots have a null applicant_id and won't match.
      selectInChunks(ids, (chunk) =>
        supabase.from("coffee_chats").select("applicant_id, member_id, complete").in("applicant_id", chunk),
      ),
      // Attendance is under member_id or applicant_id; both are auth user ids.
      fetchInfoseshAttendedIds(supabase, ids),
      // Board/exec = access_level in ('board','exec'), same as is_board_or_exec().
      selectInChunks(ids, (chunk) =>
        supabase
          .from("members_roles")
          .select("user_id, roles!inner(access_level)")
          .in("user_id", chunk)
          .in("roles.access_level", ["board", "exec"]),
      ),
      // Cross-project shortlists (0086).
      appIds.length
        ? selectInChunks(appIds, (chunk) =>
            supabase
              .from("application_wishlist")
              .select("application_id, project_id, projects(id, name, color)")
              .in("application_id", chunk),
          )
        : Promise.resolve([] as never[]),
    ]);
    for (const uid of infoAttended) attendedInfo.add(uid);
    for (const m of mem as (Applicant & { status: string | null })[]) {
      byId[m.user_id] = m;
      // A past member (active or rolled-off) is "returning"; mirrors is_returning_member().
      returningById[m.user_id] = m.status === "active" || m.status === "inactive";
    }
    for (const r of roleRows as { user_id: string | null }[]) {
      if (r.user_id) boardExecIds.add(r.user_id);
    }
    const chatRows = chats as { applicant_id: string; member_id: string; complete: boolean }[];
    for (const ch of chatRows) {
      if (ch.complete) coffeeById[ch.applicant_id] = "done";
      else if (coffeeById[ch.applicant_id] !== "done") coffeeById[ch.applicant_id] = "booked";
    }
    const hostIds = [...new Set(chatRows.map((ch) => ch.member_id).filter(Boolean))];
    const hostNameById: Record<string, string> = {};
    if (hostIds.length) {
      const hosts = await selectInChunks(hostIds, (chunk) =>
        supabase.from("members").select("user_id, preferred_firstname, lastname").in("user_id", chunk),
      );
      for (const h of hosts as { user_id: string; preferred_firstname: string | null; lastname: string | null }[]) {
        const name = [h.preferred_firstname, h.lastname].filter(Boolean).join(" ");
        if (name) hostNameById[h.user_id] = name;
      }
    }
    coffeeWithById = coffeeWithByApplicant(chatRows, hostNameById);
    for (const w of wishRows as unknown as {
      application_id: string;
      project_id: string;
      projects: { id: string; name: string; color: string | null } | null;
    }[]) {
      if (excludeProjectId && w.project_id === excludeProjectId) continue;
      const project: WishlistProject = {
        id: w.project_id,
        name: w.projects?.name ?? "Untitled project",
        color: w.projects?.color ?? null,
      };
      (wishlistedById[w.application_id] ??= []).push(project);
    }
    for (const list of Object.values(wishlistedById)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return rows.map(({ applicant_id, ...r }) => {
    const coffee: CoffeeState = (applicant_id && coffeeById[applicant_id]) || "none";
    const returning = !!applicant_id && !!returningById[applicant_id];
    const infosession = !!applicant_id && attendedInfo.has(applicant_id);
    const boardExec = !!applicant_id && boardExecIds.has(applicant_id);
    return {
      ...r,
      applicant: applicant_id
        ? byId[applicant_id] ?? { user_id: applicant_id, preferred_firstname: null, lastname: null }
        : null,
      coffee,
      coffeeWith: (applicant_id && coffeeWithById[applicant_id]) || [],
      returning,
      infosession,
      valid: isRecruitingValid({ boardExec, returning, coffeeDone: coffee === "done", infosession }),
      wishlistedBy: wishlistedById[r.id] ?? [],
    };
  });
}
