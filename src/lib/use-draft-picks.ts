"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDraftRealtime } from "@/lib/use-draft-realtime";

export type RoundProjectInfo = { id: string; round_number: number; pick_count: number; submitted_at: string | null };
export type PickRow = { id: string; round_project_id: string; application_id: string };

// Where the whole period's draft is: not started (no current pick), in
// progress (a current pick, not yet completed), or complete.
export type DraftPhase = "not_started" | "in_progress" | "complete";
// The project currently on the clock, resolved from draft_state.current_pick_id.
export type CurrentTurn = { projectId: string; projectName: string; roundNumber: number } | null;
// This project's place relative to the current pick: how many picks until its
// turn (0 = on the clock now), or null if it has nothing left to pick.
export type MyPosition = { picksUntilTurn: number; onTheClock: boolean } | null;

// One stop in the flattened draft order (a project's pick within a round),
// sorted by round then pick_order, skipping projects sitting a round out.
type Stop = { id: string; projectId: string; projectName: string; roundNumber: number; pickOrder: number; submittedAt: string | null };

// A row from the full-period draft_round_projects fetch.
type SeqRow = {
  id: string;
  project_id: string;
  pick_order: number;
  pick_count: number;
  submitted_at: string | null;
  draft_rounds: { round_number: number } | null;
  projects: { name: string } | null;
};

// Draft-round state for one project within one period: the whole period's
// phase and pick order, whose turn it is, what this project's upcoming round's
// capacity is, what's staged in its draft window, and what's confirmed. Shared
// by the wishlist card ("move to draft window") and the draft-window panel so
// both read the same fetch instead of drifting out of sync. Refreshes live via
// useDraftRealtime -- no page reload needed as the draft advances.
export function useDraftPicks(projectId: string | null, periodId: string | null) {
  const [currentPickId, setCurrentPickId] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [roundProjects, setRoundProjects] = useState<RoundProjectInfo[] | null>(null);
  const [sequence, setSequence] = useState<Stop[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!projectId || !periodId) {
      setRoundProjects([]); setPicks([]); setSequence([]); setCurrentPickId(null); setCompletedAt(null); return;
    }
    setRoundProjects(null);
    const supabase = createClient();
    const [{ data: stateRow }, { data: rpRows, error: rpError }] = await Promise.all([
      supabase.from("draft_state").select("current_pick_id, completed_at").eq("period_id", periodId).maybeSingle(),
      // Every project's round-projects for this period (not just this one), so
      // we can build the full pick order and name whoever is on the clock.
      // Gated by draft_round_projects' board/exec SELECT policy (0076).
      supabase
        .from("draft_round_projects")
        .select("id, project_id, pick_order, pick_count, submitted_at, draft_rounds!inner(round_number, period_id), projects(name)")
        .eq("draft_rounds.period_id", periodId),
    ]);
    setCurrentPickId(stateRow?.current_pick_id ?? null);
    setCompletedAt(stateRow?.completed_at ?? null);

    if (rpError) { setError("Couldn't load this project's draft rounds."); setRoundProjects([]); setPicks([]); setSequence([]); return; }

    const allRows = ((rpRows ?? []) as unknown as SeqRow[]).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.projects?.name ?? "A project",
      roundNumber: r.draft_rounds?.round_number ?? 0,
      pickOrder: r.pick_order,
      pickCount: r.pick_count,
      submittedAt: r.submitted_at,
    }));

    // Flattened pick order for the whole period (projects sitting a round out
    // -- pick_count 0 -- are excluded from the sequence, same as the exec's
    // draft-rounds manager).
    const seq: Stop[] = allRows
      .filter((r) => r.pickCount > 0)
      .sort((a, b) => (a.roundNumber - b.roundNumber) || (a.pickOrder - b.pickOrder))
      .map((r) => ({ id: r.id, projectId: r.projectId, projectName: r.projectName, roundNumber: r.roundNumber, pickOrder: r.pickOrder, submittedAt: r.submittedAt }));
    setSequence(seq);

    // This project's own rounds (the shape the rest of the hook already uses).
    const rpList = allRows
      .filter((r) => r.projectId === projectId)
      .map((r) => ({ id: r.id, pick_count: r.pickCount, submitted_at: r.submittedAt, round_number: r.roundNumber }))
      .sort((a, b) => a.round_number - b.round_number);
    setRoundProjects(rpList);

    const ids = rpList.map((r) => r.id);
    if (!ids.length) { setPicks([]); return; }
    const { data: pickRows } = await supabase.from("draft_picks").select("id, round_project_id, application_id").in("round_project_id", ids);
    setPicks((pickRows ?? []) as PickRow[]);
  }, [projectId, periodId]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useDraftRealtime(periodId, loadAll);

  const draftStarted = currentPickId !== null;
  const phase: DraftPhase = completedAt ? "complete" : draftStarted ? "in_progress" : "not_started";
  const roundProjectById = new Map((roundProjects ?? []).map((rp) => [rp.id, rp]));

  const nextRound = (roundProjects ?? [])
    .filter((rp) => rp.pick_count > 0 && rp.submitted_at === null)
    .sort((a, b) => a.round_number - b.round_number)[0] ?? null;
  const isMyTurn = !!nextRound && nextRound.id === currentPickId;

  // Who is on the clock, and how far off this project's next pick is.
  const currentTurn: CurrentTurn = useMemo(() => {
    const stop = sequence.find((s) => s.id === currentPickId);
    return stop ? { projectId: stop.projectId, projectName: stop.projectName, roundNumber: stop.roundNumber } : null;
  }, [sequence, currentPickId]);

  const myPosition: MyPosition = useMemo(() => {
    if (phase !== "in_progress" || !nextRound) return null;
    const currentIdx = sequence.findIndex((s) => s.id === currentPickId);
    const myIdx = sequence.findIndex((s) => s.id === nextRound.id);
    if (currentIdx < 0 || myIdx < 0) return null;
    const picksUntilTurn = Math.max(0, myIdx - currentIdx);
    return { picksUntilTurn, onTheClock: picksUntilTurn === 0 };
  }, [phase, sequence, currentPickId, nextRound]);

  // Nothing is staged unless a draft is actually running -- the window reads as
  // empty before it starts and after it completes.
  const draftWindowPicks = useMemo(
    () => (phase === "in_progress" && nextRound ? picks.filter((p) => p.round_project_id === nextRound.id) : []),
    [phase, nextRound, picks],
  );

  const confirmedPicks = picks
    .map((p) => ({ ...p, round: roundProjectById.get(p.round_project_id) ?? null }))
    .filter((p): p is PickRow & { round: RoundProjectInfo } => !!p.round?.submitted_at)
    .sort((a, b) => a.round.round_number - b.round.round_number);

  // Stages an applicant into the current upcoming round's draft window.
  // Independent of the wishlist -- an applicant can be staged straight from
  // the Applicants list too, not just from the wishlist.
  const addToDraftWindow = useCallback(async (applicationId: string) => {
    if (!nextRound) return false;
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("draft_picks")
      .insert({ round_project_id: nextRound.id, application_id: applicationId });
    if (insertError) { setError("The draft window is full for this round."); return false; }
    await loadAll();
    return true;
  }, [nextRound, loadAll]);

  // Un-stages an applicant from the draft window, wherever it's dragged to
  // next. No-op (succeeds) if they aren't currently staged.
  const removeFromDraftWindow = useCallback(async (applicationId: string) => {
    const pick = draftWindowPicks.find((p) => p.application_id === applicationId);
    if (!pick) return true;
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("draft_picks").delete().eq("id", pick.id);
    if (deleteError) { setError("Couldn't remove that applicant from the draft window."); return false; }
    await loadAll();
    return true;
  }, [draftWindowPicks, loadAll]);

  const submit = useCallback(async () => {
    if (!nextRound) return false;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("submit_draft_picks", { p_round_project_id: nextRound.id });
    if (rpcError) { setError(rpcError.message || "Couldn't submit picks."); return false; }
    await loadAll();
    return true;
  }, [nextRound, loadAll]);

  return {
    draftStarted,
    phase,
    completedAt,
    currentTurn,
    myPosition,
    nextRound,
    isMyTurn,
    draftWindowPicks,
    confirmedPicks,
    error,
    setError,
    addToDraftWindow,
    removeFromDraftWindow,
    submit,
    reload: loadAll,
  };
}
