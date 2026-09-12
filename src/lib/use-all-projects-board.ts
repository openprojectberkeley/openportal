"use client";

// Cross-project draft board for a whole application period: every project and
// who it has confirmed / staged in the draft. The exec's read-only counterpart
// to a PM's single-project DraftWindowPanel -- one fetch for the entire period
// rather than one per project. Deliberately draft-only: the existing roster
// isn't shown here, so it isn't fetched either.
//
// Readable without any new policy: draft_picks_select (0072) is
// can_review_project(), which short-circuits on can_review_all_projects()
// (0057), so a full-access reviewer already sees staged *and* confirmed picks
// everywhere.

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewStatus } from "@/components/application-review-modal";
import { applicantName, type AppRow } from "@/components/applicant-meta";
import { enrichAppRows, type BaseAppRow } from "@/lib/applicant-rows";
import { selectInChunks } from "@/lib/postgrest-chunk";
import { useDraftRealtime } from "@/lib/use-draft-realtime";

// The statuses the draft can still place. Rejected applications are out of
// play, so they belong to neither the roster nor its head count.
const DRAFT_ELIGIBLE_STATUSES = ["submitted", "accepted"] as const;

export type BoardProject = {
  id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
};

// One drafted person in a column. Confirmed and staged sit in the same flat,
// draft-ordered list -- the board shows who a project drafted, not which round
// each pick came from -- so `submitted` is what tells the two apart. The pick
// id and the applicant's accepted project ride along because the board's own
// actions need them: move_draft_pick takes a pick id, and the outcome menu has
// to know whether "Accepted" means accepted onto *this* column.
export type BoardCard = {
  app: AppRow;
  pickId: string;
  roundProjectId: string;
  submitted: boolean;
  acceptedProjectId: string | null;
};

export type BoardColumn = {
  project: BoardProject;
  picks: BoardCard[];
};

type RoundProjectRow = {
  id: string;
  project_id: string;
  pick_order: number;
  submitted_at: string | null;
  draft_rounds: { round_number: number } | null;
  draft_picks: { id: string; application_id: string; created_at: string }[];
};

// One applicant's place in a column, before the AppRow is resolved.
type Slot = {
  pickId: string;
  appId: string;
  roundProjectId: string;
  roundNumber: number;
  createdAt: string;
  submitted: boolean;
};

export function useAllProjectsBoard(periodId: string | null, enabled: boolean, reloadToken = 0) {
  const [columns, setColumns] = useState<BoardColumn[] | null>(null);
  // Projects with a round-project this period. The board's "Move to" menu and
  // its add-applicant card may only target these -- anything else raises
  // "That project is not drafting in this application period." (0091).
  const [draftProjectIds, setDraftProjectIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Generation guard: this load has two awaited round trips, so a period switch
  // (or a realtime refetch) can overtake an in-flight one. Only the newest load
  // is allowed to write, otherwise a slow earlier fetch lands last and wins.
  const genRef = useRef(0);

  const loadAll = useCallback(async () => {
    if (!enabled || !periodId) { setColumns(null); return; }
    const gen = ++genRef.current;
    const supabase = createClient();

    const [{ data: projRows }, { data: rpRows, error: rpError }] = await Promise.all([
      supabase.from("projects").select("id, name, icon, icon_url, color").order("name"),
      // Nested draft_picks keeps the whole period's board to one round trip --
      // same shape as the exec draft manager's loadBoard.
      supabase
        .from("draft_round_projects")
        .select("id, project_id, pick_order, submitted_at, draft_rounds!inner(round_number, period_id), draft_picks(id, application_id, created_at)")
        .eq("draft_rounds.period_id", periodId),
    ]);

    if (gen !== genRef.current) return;
    if (rpError) {
      setError("Couldn't load the draft board.");
      setColumns([]);
      return;
    }
    setError(null);

    const projects = (projRows ?? []) as BoardProject[];
    const rounds = (rpRows ?? []) as unknown as RoundProjectRow[];

    // One bucket per project: staged and confirmed picks share a list, each
    // carrying its own `submitted` flag for the card to paint itself with.
    const slotsByProject: Record<string, Slot[]> = {};
    // Draft position, for column order: the pick_order of a project's earliest round.
    const orderByProject: Record<string, { roundNumber: number; pickOrder: number }> = {};
    const appIdSet = new Set<string>();
    const draftProjects = new Set<string>();
    for (const rp of rounds) {
      const roundNumber = rp.draft_rounds?.round_number ?? 0;
      draftProjects.add(rp.project_id);
      const seen = orderByProject[rp.project_id];
      if (!seen || roundNumber < seen.roundNumber) {
        orderByProject[rp.project_id] = { roundNumber, pickOrder: rp.pick_order };
      }
      for (const pick of rp.draft_picks ?? []) {
        (slotsByProject[rp.project_id] ??= []).push({
          pickId: pick.id,
          appId: pick.application_id,
          roundProjectId: rp.id,
          roundNumber,
          createdAt: pick.created_at,
          submitted: !!rp.submitted_at,
        });
        appIdSet.add(pick.application_id);
      }
    }

    // One enrichment pass for every picked applicant in the period. `rank` is
    // per project, so it's left at 0 here and filled in per column below.
    const appIds = [...appIdSet];
    const rowById = new Map<string, AppRow>();
    const rankByAppProject: Record<string, number> = {};
    // Which project (if any) already accepted them -- not part of AppRow, since
    // only this board's outcome menu needs it.
    const acceptedByAppId: Record<string, string | null> = {};
    if (appIds.length) {
      const [apps, rankings] = await Promise.all([
        selectInChunks<{
          id: string;
          applicant_id: string | null;
          status: ReviewStatus;
          submitted_at: string | null;
          accepted_project_id: string | null;
        }>(appIds, (chunk) =>
          supabase
            .from("applications")
            .select("id, applicant_id, status, submitted_at, accepted_project_id")
            .in("id", chunk),
        ),
        selectInChunks<{ application_id: string; project_id: string; rank: number }>(appIds, (chunk) =>
          supabase.from("application_rankings").select("application_id, project_id, rank").in("application_id", chunk).eq("ranked", true),
        ),
      ]);
      for (const r of rankings) rankByAppProject[`${r.application_id}:${r.project_id}`] = r.rank;
      for (const a of apps) acceptedByAppId[a.id] = a.accepted_project_id;
      const base: BaseAppRow[] = apps.map((a) => ({
        id: a.id,
        status: a.status,
        submitted_at: a.submitted_at,
        applicant_id: a.applicant_id,
        rank: 0,
      }));
      for (const row of await enrichAppRows(supabase, base)) rowById.set(row.id, row);
      if (gen !== genRef.current) return;
    }

    // A card in project X's column shows X's rank and drops X from the
    // "also wishlisted by" chips -- that column already speaks for X.
    const forColumn = (slot: Slot, projectId: string): BoardCard | null => {
      const row = rowById.get(slot.appId);
      if (!row) return null;
      return {
        app: {
          ...row,
          rank: rankByAppProject[`${slot.appId}:${projectId}`] ?? 0,
          wishlistedBy: row.wishlistedBy.filter((w) => w.id !== projectId),
        },
        pickId: slot.pickId,
        roundProjectId: slot.roundProjectId,
        submitted: slot.submitted,
        acceptedProjectId: acceptedByAppId[slot.appId] ?? null,
      };
    };
    const bySequence = (a: Slot, b: Slot) =>
      a.roundNumber - b.roundNumber || a.createdAt.localeCompare(b.createdAt);

    // The list stays in draft sequence (round, then pick time) -- the round
    // itself is no longer surfaced, only the order it produced.
    const next: BoardColumn[] = projects.map((project) => ({
      project,
      picks: (slotsByProject[project.id] ?? [])
        .sort(bySequence)
        .map((slot) => forColumn(slot, project.id))
        .filter((c): c is BoardCard => !!c),
    }));

    // Projects in the draft come first, in draft order; the rest trail
    // alphabetically (projects is already name-ordered).
    next.sort((a, b) => {
      const oa = orderByProject[a.project.id];
      const ob = orderByProject[b.project.id];
      if (oa && ob) return oa.pickOrder - ob.pickOrder || a.project.name.localeCompare(b.project.name);
      if (oa) return -1;
      if (ob) return 1;
      return 0;
    });

    setColumns(next);
    setDraftProjectIds(draftProjects);
  }, [enabled, periodId]);

  // Clean slate when the period changes or the view is left, so stale columns
  // never flash; background refetches (realtime, reloadToken) update in place.
  useEffect(() => { genRef.current++; setColumns(null); }, [periodId, enabled]);
  useEffect(() => { loadAll(); }, [loadAll, reloadToken]);
  useDraftRealtime(enabled ? periodId : null, loadAll);

  return { columns, draftProjectIds, error, reload: loadAll };
}

// The add-member picker's roster: every draft-eligible applicant this period,
// name-sorted. Fetched lazily on first open rather than folded into loadAll --
// that runs again on every realtime tick, and this list only matters while the
// picker is open. Mirrors the draft manager's loadPeriodApplicants.
export function usePeriodApplicants(periodId: string | null) {
  const [applicants, setApplicants] = useState<{ id: string; name: string }[] | null>(null);
  const loadedFor = useRef<string | null>(null);

  // A period switch invalidates whatever was fetched for the previous one.
  useEffect(() => {
    loadedFor.current = null;
    setApplicants(null);
  }, [periodId]);

  const load = useCallback(async () => {
    if (!periodId || loadedFor.current === periodId) return;
    loadedFor.current = periodId;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("applications")
      .select("id, applicant_id")
      .eq("period_id", periodId)
      .in("status", DRAFT_ELIGIBLE_STATUSES);
    if (error) { loadedFor.current = null; return; }

    const rows = (data ?? []) as { id: string; applicant_id: string | null }[];
    const userIds = [...new Set(rows.map((r) => r.applicant_id).filter((id): id is string => !!id))];
    const nameByUser: Record<string, string> = {};
    if (userIds.length) {
      const members = await selectInChunks<{
        user_id: string;
        preferred_firstname: string | null;
        lastname: string | null;
      }>(userIds, (chunk) =>
        supabase.from("members").select("user_id, preferred_firstname, lastname").in("user_id", chunk),
      );
      for (const m of members) {
        nameByUser[m.user_id] =
          [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Applicant";
      }
    }

    setApplicants(
      rows
        .map((r) => ({ id: r.id, name: (r.applicant_id && nameByUser[r.applicant_id]) || "Applicant" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, [periodId]);

  return { applicants, load };
}

// The period's draft-eligible roster, enriched exactly like a board card, so
// the "not drafted" list can show the same recruiting indicators the columns
// do. Kept apart from `usePeriodApplicants` (which only needs id + name for
// the add-member picker) because this enrichment is the expensive one.
//
// Lazy for that reason -- it touches every applicant in the period, and only
// matters while the list is open -- and re-run on each open rather than cached:
// nothing subscribes to `applications`, so a first-open snapshot would drift as
// review carries on around it.
export type RosterRow = {
  app: AppRow;
  // Set when someone was accepted onto a project outside the draft
  // (accept_application places them without creating a pick).
  acceptedProjectId: string | null;
};

export function usePeriodRoster(periodId: string | null) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  // Cheap head count, fetched up front: it stands in for the roster's own
  // length until someone actually opens the list.
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const countGenRef = useRef(0);
  const rosterGenRef = useRef(0);

  useEffect(() => {
    const gen = ++countGenRef.current;
    rosterGenRef.current++;
    setRoster(null);
    setEligibleCount(null);
    if (!periodId) return;
    (async () => {
      const { count } = await createClient()
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("period_id", periodId)
        .in("status", DRAFT_ELIGIBLE_STATUSES);
      if (gen === countGenRef.current) setEligibleCount(count ?? 0);
    })();
  }, [periodId]);

  const load = useCallback(async () => {
    if (!periodId) return;
    const gen = ++rosterGenRef.current;
    const supabase = createClient();
    const { data } = await supabase
      .from("applications")
      .select("id, applicant_id, status, submitted_at, accepted_project_id")
      .eq("period_id", periodId)
      .in("status", DRAFT_ELIGIBLE_STATUSES);
    if (gen !== rosterGenRef.current) return;

    const rows = (data ?? []) as {
      id: string;
      applicant_id: string | null;
      status: ReviewStatus;
      submitted_at: string | null;
      accepted_project_id: string | null;
    }[];
    const acceptedByAppId: Record<string, string | null> = {};
    for (const r of rows) acceptedByAppId[r.id] = r.accepted_project_id;
    // `rank` is per project and this list belongs to no column, so it stays 0.
    const enriched = await enrichAppRows(
      supabase,
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        submitted_at: r.submitted_at,
        applicant_id: r.applicant_id,
        rank: 0,
      })),
    );
    if (gen !== rosterGenRef.current) return;

    setRoster(
      enriched
        .map((app) => ({ app, acceptedProjectId: acceptedByAppId[app.id] ?? null }))
        .sort((a, b) => applicantName(a.app).localeCompare(applicantName(b.app))),
    );
  }, [periodId]);

  return { roster, eligibleCount, load };
}
