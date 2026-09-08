"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PickRow } from "@/lib/use-draft-picks";

// Drop target id for the draft-window zone -- dragging a wishlist card here
// stages it (same DndContext as the "Left to review" -> Wishlist drag on
// applications/page.tsx).
export const DRAFT_WINDOW_DROPZONE_ID = "draft-window-dropzone";

// Shown on the Applications manager page below the shared Wishlist, only
// once a draft is active for the selected period. Draft window is a capped
// staging area for the project's upcoming round (applicants move in by
// dragging a wishlist card here); Confirmed is what's already been
// submitted this draft, across every round so far.
export function DraftWindowPanel({
  nameById,
  nextRound,
  isMyTurn,
  draftWindowPicks,
  confirmedPicks,
  onMoveBackToWishlist,
  onSubmit,
}: {
  nameById: Map<string, string>;
  nextRound: { id: string; round_number: number; pick_count: number } | null;
  isMyTurn: boolean;
  draftWindowPicks: PickRow[];
  confirmedPicks: (PickRow & { round: { round_number: number } })[];
  onMoveBackToWishlist: (pick: PickRow) => void;
  onSubmit: () => Promise<boolean>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: DRAFT_WINDOW_DROPZONE_ID, disabled: !nextRound });

  const submit = async () => {
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Confirmed */}
      <div className="flex flex-col gap-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Confirmed{confirmedPicks.length ? ` (${confirmedPicks.length})` : ""}
        </h2>
        {confirmedPicks.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-xl">
            No picks confirmed yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {confirmedPicks.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                <span className="flex-1 min-w-0 truncate text-sm font-medium">{nameById.get(p.application_id) ?? "Applicant"}</span>
                <Badge variant="outline">Round {p.round.round_number}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Draft window */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Draft window{nextRound ? ` (${draftWindowPicks.length}/${nextRound.pick_count})` : ""}
          </h2>
          {nextRound && (
            <Button size="sm" className="h-7 px-2.5 text-xs" onClick={submit} disabled={!isMyTurn || draftWindowPicks.length === 0 || submitting}>
              {submitting ? "Submitting…" : isMyTurn ? "Submit" : "Not your turn yet"}
            </Button>
          )}
        </div>
        <div ref={setNodeRef} className={`rounded-xl transition-colors ${isOver ? "ring-2 ring-primary ring-offset-1" : ""}`}>
          {!nextRound ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-xl">
              No upcoming round to draft into.
            </div>
          ) : draftWindowPicks.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground border-2 border-dashed rounded-xl">
              Round {nextRound.round_number} — drag up to {nextRound.pick_count} from your wishlist.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {draftWindowPicks.map((p) => (
                <div key={p.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">{nameById.get(p.application_id) ?? "Applicant"}</span>
                  <button
                    onClick={() => onMoveBackToWishlist(p)}
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
      </div>
    </>
  );
}
