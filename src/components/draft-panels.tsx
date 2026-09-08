"use client";

import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PickRow } from "@/lib/use-draft-picks";

// Drop target id for the draft-window zone -- a peer of the wishlist and
// "Left to review" drop zones on applications/page.tsx (same DndContext).
// An applicant card can be dragged in from either, and dragged back out to
// either, directly -- staging isn't gated behind the wishlist.
export const DRAFT_WINDOW_DROPZONE_ID = "draft-window-dropzone";

// A staged (not yet submitted) draft-window pick -- draggable back out to
// the wishlist or "Left to review", same gesture as dragging it in.
function DraftWindowCard({ applicationId, name }: { applicationId: string; name: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: applicationId });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-background ${isDragging ? "relative z-10 opacity-50 shadow-lg" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab touch-none shrink-0"
        aria-label="Drag out of the draft window"
      >
        <GripVertical size={14} />
      </button>
      <span className="flex-1 min-w-0 truncate text-sm font-medium">{name}</span>
    </div>
  );
}

// Shown on the Applications manager page, only once a draft is active for
// the selected period. Draft window is a capped staging area for the
// project's upcoming round -- drag an applicant card in from anywhere
// (Wishlist or "Left to review"), drag one back out the same way; Confirmed
// is what's already been submitted this draft, across every round so far.
export function DraftWindowPanel({
  nameById,
  nextRound,
  isMyTurn,
  draftWindowPicks,
  confirmedPicks,
  onSubmit,
}: {
  nameById: Map<string, string>;
  nextRound: { id: string; round_number: number; pick_count: number } | null;
  isMyTurn: boolean;
  draftWindowPicks: PickRow[];
  confirmedPicks: (PickRow & { round: { round_number: number } })[];
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
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-2 rounded-xl border-2 border-dashed p-3 min-h-[76px] transition-colors ${
            isOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
          }`}
        >
          {!nextRound ? (
            <p className="text-xs text-muted-foreground text-center py-4">No upcoming round to draft into.</p>
          ) : draftWindowPicks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Drag up to {nextRound.pick_count} applicants here for Round {nextRound.round_number}.
            </p>
          ) : (
            draftWindowPicks.map((p) => (
              <DraftWindowCard key={p.id} applicationId={p.application_id} name={nameById.get(p.application_id) ?? "Applicant"} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
