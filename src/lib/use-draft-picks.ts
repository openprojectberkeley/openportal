"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";

export type RoundProjectInfo = { id: string; round_number: number; pick_count: number; submitted_at: string | null };
export type PickRow = { id: string; round_project_id: string; application_id: string };

// Draft-round state for one project within one period: whose turn it is,
// what their upcoming round's capacity is, what's currently staged in their
// draft window, and what's already been confirmed this draft. Shared by the
// wishlist card ("move to draft window") and the draft-window panel so both
// read the same fetch instead of drifting out of sync.
export function useDraftPicks(projectId: string | null, periodId: string | null) {
  const [currentPickId, setCurrentPickId] = useState<string | null>(null);
  const [roundProjects, setRoundProjects] = useState<RoundProjectInfo[] | null>(null);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!projectId || !periodId) { setRoundProjects([]); setPicks([]); setCurrentPickId(null); return; }
    setRoundProjects(null);
    const supabase = createClient();
    const [{ data: stateRow }, { data: rpRows, error: rpError }] = await Promise.all([
      supabase.from("draft_state").select("current_pick_id").eq("period_id", periodId).maybeSingle(),
      supabase
        .from("draft_round_projects")
        .select("id, pick_count, submitted_at, draft_rounds!inner(round_number, period_id)")
        .eq("project_id", projectId)
        .eq("draft_rounds.period_id", periodId),
    ]);
    setCurrentPickId(stateRow?.current_pick_id ?? null);

    if (rpError) { setError("Couldn't load this project's draft rounds."); setRoundProjects([]); setPicks([]); return; }

    type Row = { id: string; pick_count: number; submitted_at: string | null; draft_rounds: { round_number: number } | null };
    const rpList = ((rpRows ?? []) as unknown as Row[])
      .map((r) => ({ id: r.id, pick_count: r.pick_count, submitted_at: r.submitted_at, round_number: r.draft_rounds?.round_number ?? 0 }))
      .sort((a, b) => a.round_number - b.round_number);
    setRoundProjects(rpList);

    const ids = rpList.map((r) => r.id);
    if (!ids.length) { setPicks([]); return; }
    const { data: pickRows } = await supabase.from("draft_picks").select("id, round_project_id, application_id").in("round_project_id", ids);
    setPicks((pickRows ?? []) as PickRow[]);
  }, [projectId, periodId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const draftStarted = currentPickId !== null;
  const roundProjectById = new Map((roundProjects ?? []).map((rp) => [rp.id, rp]));

  const nextRound = (roundProjects ?? [])
    .filter((rp) => rp.pick_count > 0 && rp.submitted_at === null)
    .sort((a, b) => a.round_number - b.round_number)[0] ?? null;
  const isMyTurn = !!nextRound && nextRound.id === currentPickId;

  const draftWindowPicks = nextRound ? picks.filter((p) => p.round_project_id === nextRound.id) : [];
  const canAddToDraftWindow = !!nextRound && draftWindowPicks.length < nextRound.pick_count;

  const confirmedPicks = picks
    .map((p) => ({ ...p, round: roundProjectById.get(p.round_project_id) ?? null }))
    .filter((p): p is PickRow & { round: RoundProjectInfo } => !!p.round?.submitted_at)
    .sort((a, b) => a.round.round_number - b.round.round_number);

  // Stages an applicant into the current upcoming round's draft window.
  // Does not touch the wishlist -- the caller (which owns wishlist state)
  // removes it from there on success.
  const moveToDraftWindow = useCallback(async (applicationId: string) => {
    if (!nextRound) return false;
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("draft_picks")
      .insert({ round_project_id: nextRound.id, application_id: applicationId });
    if (insertError) { setError("The draft window is full for this round."); return false; }
    await loadAll();
    return true;
  }, [nextRound, loadAll]);

  // Un-stages a draft-window pick. Does not touch the wishlist -- the caller
  // re-adds it there on success.
  const moveBackToWishlist = useCallback(async (pick: PickRow) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("draft_picks").delete().eq("id", pick.id);
    if (deleteError) { setError("Couldn't remove that applicant from the draft window."); return false; }
    await loadAll();
    return true;
  }, [loadAll]);

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
    nextRound,
    isMyTurn,
    draftWindowPicks,
    confirmedPicks,
    canAddToDraftWindow,
    error,
    setError,
    moveToDraftWindow,
    moveBackToWishlist,
    submit,
    reload: loadAll,
  };
}
