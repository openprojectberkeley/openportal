"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DraggableApplicantCard, applicantName, type AppRow } from "@/components/applicant-meta";
import type { PickRow } from "@/lib/use-draft-picks";

// Drop target id for the draft-window zone -- a peer of the wishlist and
// "Left to review" drop zones on applications/page.tsx (same DndContext).
// An applicant card can be dragged in from either, and dragged back out to
// either, directly -- staging isn't gated behind the wishlist.
export const DRAFT_WINDOW_DROPZONE_ID = "draft-window-dropzone";

// Shown on the Applications manager page, only once a draft is active for
// the selected period. Draft window is a capped staging area for the
// project's upcoming round -- drag an applicant card in from anywhere
// (Wishlist or "Left to review"), drag one back out the same way. Staged
// picks keep the full applicant card (Review button, status/late/returning/
// coffee/infosession badges) the whole time; that only goes away once a
// pick is actually confirmed, shown below as a plain name + round badge.
export function DraftWindowPanel({
  appById,
  periodEndsAt,
  onReview,
  nextRound,
  isMyTurn,
  draftWindowPicks,
  confirmedPicks,
  onSubmit,
  onRemove,
}: {
  appById: Map<string, AppRow>;
  periodEndsAt: string | undefined;
  onReview: (app: AppRow) => void;
  nextRound: { id: string; round_number: number; pick_count: number } | null;
  isMyTurn: boolean;
  draftWindowPicks: PickRow[];
  confirmedPicks: (PickRow & { round: { round_number: number } })[];
  onSubmit: () => Promise<boolean>;
  // Un-stages a pick, sending the applicant back to "Left to review" (same
  // gesture as the wishlist's remove button, minus the drag). Also used for
  // an orphaned pick -- one whose applicant isn't in the current review
  // list anymore (e.g. they unranked this project, or their status
  // changed) -- which still counts against pick_count on the server, so it
  // must stay visible and removable rather than silently vanishing while
  // still taking up a slot.
  onRemove: (applicationId: string) => void;
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
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Confirmed{confirmedPicks.length ? ` (${confirmedPicks.length})` : ""}
          </h2>
          {confirmedPicks.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Locked in, but not yet team members — that happens once the draft is completed.
            </p>
          )}
        </div>
        {confirmedPicks.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-xl">
            No picks confirmed yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {confirmedPicks.map((p) => {
              const app = appById.get(p.application_id);
              return (
                <div key={p.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">{app ? applicantName(app) : "Applicant"}</span>
                  <Badge variant="outline">Round {p.round.round_number}</Badge>
                </div>
              );
            })}
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
            draftWindowPicks.map((p) => {
              const app = appById.get(p.application_id);
              if (!app) {
                return (
                  <div key={p.id} className="flex items-center gap-2 border border-amber-400/50 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/30">
                    <span className="flex-1 min-w-0 truncate text-sm text-muted-foreground italic">
                      Applicant no longer in this project&apos;s review list
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onRemove(p.application_id)}
                    >
                      Remove
                    </Button>
                  </div>
                );
              }
              return (
                <DraggableApplicantCard
                  key={p.id}
                  app={app}
                  periodEndsAt={periodEndsAt}
                  onReview={() => onReview(app)}
                  onRemove={() => onRemove(app.id)}
                />
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
