"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, ArrowRight, ChevronDown, Plus, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { ReviewStatus } from "@/components/application-review-modal";

export type DraftApplicant = { applicationId: string; name: string; status: ReviewStatus };

type WishlistEntry = { id: string; application_id: string; position: number };
type RoundProjectInfo = { id: string; round_number: number; pick_count: number; submitted_at: string | null };
type PickRow = { id: string; round_project_id: string; application_id: string };

// Shown on the Applications manager page once a draft is active: a PM's
// shortlist (Wishlist), a capped staging area for their upcoming round
// (Draft window), and what's already been submitted this draft (Confirmed).
export function DraftPanels({
  projectId,
  periodId,
  applicants,
  onDrafted,
}: {
  projectId: string;
  periodId: string;
  applicants: DraftApplicant[];
  onDrafted: () => void;
}) {
  const [currentPickId, setCurrentPickId] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<WishlistEntry[]>([]);
  const [roundProjects, setRoundProjects] = useState<RoundProjectInfo[] | null>(null);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setRoundProjects(null);
    const supabase = createClient();
    const [{ data: stateRow }, { data: wishlistRows }, { data: rpRows, error: rpError }] = await Promise.all([
      supabase.from("draft_state").select("current_pick_id").eq("period_id", periodId).maybeSingle(),
      supabase.from("draft_wishlist_entries").select("id, application_id, position").eq("project_id", projectId).order("position"),
      supabase
        .from("draft_round_projects")
        .select("id, pick_count, submitted_at, draft_rounds!inner(round_number, period_id)")
        .eq("project_id", projectId)
        .eq("draft_rounds.period_id", periodId),
    ]);
    setCurrentPickId(stateRow?.current_pick_id ?? null);
    setWishlist((wishlistRows ?? []) as WishlistEntry[]);

    if (rpError) { setError("Couldn't load this project's draft rounds."); setRoundProjects([]); setPicks([]); return; }

    type Row = { id: string; pick_count: number; submitted_at: string | null; draft_rounds: { round_number: number } | null };
    const rpList = ((rpRows ?? []) as unknown as Row[])
      .map((r) => ({ id: r.id, pick_count: r.pick_count, submitted_at: r.submitted_at, round_number: r.draft_rounds?.round_number ?? 0 }))
      .sort((a, b) => a.round_number - b.round_number);
    setRoundProjects(rpList);

    const ids = rpList.map((r) => r.id);
    if (!ids.length) { setPicks([]); return; }
    const supabase2 = createClient();
    const { data: pickRows } = await supabase2.from("draft_picks").select("id, round_project_id, application_id").in("round_project_id", ids);
    setPicks((pickRows ?? []) as PickRow[]);
  }, [projectId, periodId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const draftStarted = currentPickId !== null;
  const nameById = new Map(applicants.map((a) => [a.applicationId, a.name]));
  const roundProjectById = new Map((roundProjects ?? []).map((rp) => [rp.id, rp]));

  const nextRound = (roundProjects ?? [])
    .filter((rp) => rp.pick_count > 0 && rp.submitted_at === null)
    .sort((a, b) => a.round_number - b.round_number)[0] ?? null;
  const isMyTurn = !!nextRound && nextRound.id === currentPickId;

  const draftWindowPicks = nextRound ? picks.filter((p) => p.round_project_id === nextRound.id) : [];
  const confirmedPicks = picks
    .map((p) => ({ ...p, round: roundProjectById.get(p.round_project_id) ?? null }))
    .filter((p) => p.round?.submitted_at)
    .sort((a, b) => (a.round!.round_number - b.round!.round_number));

  const placedIds = new Set([...wishlist.map((w) => w.application_id), ...picks.map((p) => p.application_id)]);
  const addable = applicants.filter((a) => a.status === "submitted" && !placedIds.has(a.applicationId));

  const addToWishlist = async (applicationId: string) => {
    const supabase = createClient();
    const nextPosition = wishlist.length ? Math.max(...wishlist.map((w) => w.position)) + 1 : 1;
    const { error: insertError } = await supabase
      .from("draft_wishlist_entries")
      .insert({ project_id: projectId, application_id: applicationId, position: nextPosition });
    if (insertError) { setError("Couldn't add to the wishlist."); return; }
    loadAll();
  };

  const removeFromWishlist = async (entryId: string) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("draft_wishlist_entries").delete().eq("id", entryId);
    if (deleteError) { setError("Couldn't remove from the wishlist."); return; }
    loadAll();
  };

  const moveToDraftWindow = async (entry: WishlistEntry) => {
    if (!nextRound) { setError("No upcoming round to draft into."); return; }
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("draft_picks")
      .insert({ round_project_id: nextRound.id, application_id: entry.application_id });
    if (insertError) { setError("The draft window is full for this round."); return; }
    await supabase.from("draft_wishlist_entries").delete().eq("id", entry.id);
    loadAll();
  };

  const moveBackToWishlist = async (pick: PickRow) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("draft_picks").delete().eq("id", pick.id);
    if (deleteError) { setError("Couldn't remove that applicant from the draft window."); return; }
    const nextPosition = wishlist.length ? Math.max(...wishlist.map((w) => w.position)) + 1 : 1;
    await supabase.from("draft_wishlist_entries").insert({ project_id: projectId, application_id: pick.application_id, position: nextPosition });
    loadAll();
  };

  const submit = async () => {
    if (!nextRound) return;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("submit_draft_picks", { p_round_project_id: nextRound.id });
      if (rpcError) { setError(rpcError.message || "Couldn't submit picks."); return; }
      await loadAll();
      onDrafted();
    } finally {
      setSubmitting(false);
    }
  };

  if (!draftStarted) return null;

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Confirmed */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Confirmed{confirmedPicks.length ? ` (${confirmedPicks.length})` : ""}
        </h3>
        {confirmedPicks.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-xl">
            No picks confirmed yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {confirmedPicks.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{nameById.get(p.application_id) ?? "Applicant"}</span>
                <Badge variant="outline">Round {p.round!.round_number}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Draft window */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Draft window{nextRound ? ` (${draftWindowPicks.length}/${nextRound.pick_count})` : ""}
          </h3>
          {nextRound && (
            <Button size="sm" className="h-7 px-2.5 text-xs" onClick={submit} disabled={!isMyTurn || draftWindowPicks.length === 0 || submitting}>
              {submitting ? "Submitting…" : isMyTurn ? "Submit" : "Not your turn yet"}
            </Button>
          )}
        </div>
        {!nextRound ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-xl">
            No upcoming round to draft into.
          </div>
        ) : draftWindowPicks.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-xl">
            Round {nextRound.round_number} — move up to {nextRound.pick_count} from your wishlist.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {draftWindowPicks.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{nameById.get(p.application_id) ?? "Applicant"}</span>
                <button
                  onClick={() => moveBackToWishlist(p)}
                  className="text-muted-foreground/50 hover:text-muted-foreground"
                  aria-label="Move back to wishlist"
                  title="Move back to wishlist"
                >
                  <ArrowLeftRight size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wishlist */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Wishlist{wishlist.length ? ` (${wishlist.length})` : ""}
          </h3>
          {addable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs">
                  <Plus size={13} className="mr-1.5" />
                  Add
                  <ChevronDown size={12} className="ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {addable.map((a) => (
                  <DropdownMenuItem key={a.applicationId} onSelect={() => addToWishlist(a.applicationId)}>
                    {a.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {wishlist.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-xl">
            <Star size={16} className="mx-auto mb-1.5 text-muted-foreground/50" />
            Add applicants you want to draft.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {wishlist.map((w) => (
              <div key={w.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{nameById.get(w.application_id) ?? "Applicant"}</span>
                {nextRound && draftWindowPicks.length < nextRound.pick_count && (
                  <button
                    onClick={() => moveToDraftWindow(w)}
                    className="text-muted-foreground/50 hover:text-foreground"
                    aria-label="Move to draft window"
                    title="Move to draft window"
                  >
                    <ArrowRight size={15} />
                  </button>
                )}
                <button
                  onClick={() => removeFromWishlist(w.id)}
                  className="text-muted-foreground/50 hover:text-destructive"
                  aria-label="Remove from wishlist"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
