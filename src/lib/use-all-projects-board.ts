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
import type { AppRow } from "@/components/applicant-meta";
import { enrichAppRows, type BaseAppRow } from "@/lib/applicant-rows";
import { selectInChunks } from "@/lib/postgrest-chunk";
import { useDraftRealtime } from "@/lib/use-draft-realtime";

export type BoardProject = {
  id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
};

// Confirmed and staged picks alike are a flat, draft-ordered list: the board
// shows who a project drafted, not which round each pick came from.
export type BoardColumn = {
  project: BoardProject;
  confirmed: AppRow[];
  staged: AppRow[];
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
type Slot = { appId: string; roundNumber: number; createdAt: string };

export function useAllProjectsBoard(periodId: string | null, enabled: boolean, reloadToken = 0) {
  const [columns, setColumns] = useState<BoardColumn[] | null>(null);
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

    // Split each project's picks by whether their round has been submitted:
    // submitted = confirmed, unsubmitted = still sitting in a draft window.
    const confirmedSlots: Record<string, Slot[]> = {};
    const stagedSlots: Record<string, Slot[]> = {};
    // Draft position, for column order: the pick_order of a project's earliest round.
    const orderByProject: Record<string, { roundNumber: number; pickOrder: number }> = {};
    const appIdSet = new Set<string>();
    for (const rp of rounds) {
      const roundNumber = rp.draft_rounds?.round_number ?? 0;
      const seen = orderByProject[rp.project_id];
      if (!seen || roundNumber < seen.roundNumber) {
        orderByProject[rp.project_id] = { roundNumber, pickOrder: rp.pick_order };
      }
      const bucket = rp.submitted_at ? confirmedSlots : stagedSlots;
      for (const pick of rp.draft_picks ?? []) {
        (bucket[rp.project_id] ??= []).push({ appId: pick.application_id, roundNumber, createdAt: pick.created_at });
        appIdSet.add(pick.application_id);
      }
    }

    // One enrichment pass for every picked applicant in the period. `rank` is
    // per project, so it's left at 0 here and filled in per column below.
    const appIds = [...appIdSet];
    const rowById = new Map<string, AppRow>();
    const rankByAppProject: Record<string, number> = {};
    if (appIds.length) {
      const [apps, rankings] = await Promise.all([
        selectInChunks<{ id: string; applicant_id: string | null; status: ReviewStatus; submitted_at: string | null }>(
          appIds,
          (chunk) => supabase.from("applications").select("id, applicant_id, status, submitted_at").in("id", chunk),
        ),
        selectInChunks<{ application_id: string; project_id: string; rank: number }>(appIds, (chunk) =>
          supabase.from("application_rankings").select("application_id, project_id, rank").in("application_id", chunk).eq("ranked", true),
        ),
      ]);
      for (const r of rankings) rankByAppProject[`${r.application_id}:${r.project_id}`] = r.rank;
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
    const forColumn = (slot: Slot, projectId: string): AppRow | null => {
      const row = rowById.get(slot.appId);
      if (!row) return null;
      return {
        ...row,
        rank: rankByAppProject[`${slot.appId}:${projectId}`] ?? 0,
        wishlistedBy: row.wishlistedBy.filter((w) => w.id !== projectId),
      };
    };
    const bySequence = (a: Slot, b: Slot) =>
      a.roundNumber - b.roundNumber || a.createdAt.localeCompare(b.createdAt);

    // Both lists stay in draft sequence (round, then pick time) -- the round
    // itself is no longer surfaced, only the order it produced.
    const listFor = (slots: Slot[] | undefined, projectId: string) =>
      (slots ?? [])
        .sort(bySequence)
        .map((slot) => forColumn(slot, projectId))
        .filter((a): a is AppRow => !!a);

    const next: BoardColumn[] = projects.map((project) => ({
      project,
      confirmed: listFor(confirmedSlots[project.id], project.id),
      staged: listFor(stagedSlots[project.id], project.id),
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
  }, [enabled, periodId]);

  // Clean slate when the period changes or the view is left, so stale columns
  // never flash; background refetches (realtime, reloadToken) update in place.
  useEffect(() => { genRef.current++; setColumns(null); }, [periodId, enabled]);
  useEffect(() => { loadAll(); }, [loadAll, reloadToken]);
  useDraftRealtime(enabled ? periodId : null, loadAll);

  return { columns, error, reload: loadAll };
}
