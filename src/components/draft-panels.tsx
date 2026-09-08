"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StaticApplicantCard, applicantName, type AppRow } from "@/components/applicant-meta";
import type { PickRow, DraftPhase, CurrentTurn, MyPosition } from "@/lib/use-draft-picks";

// Drop target id for the draft-window zone -- a peer drop target of the
// wishlist on applications/page.tsx (same DndContext). An applicant card can
// be dragged in from the Applicants list or the wishlist (a copy -- the source
// keeps its card), or staged via the card's "add to draft window" button.
export const DRAFT_WINDOW_DROPZONE_ID = "draft-window-dropzone";

// Shown on the Applications manager page, only once a draft is active for
// the selected period. Draft window is a capped staging area for the
// project's upcoming round -- drag an applicant card in from the Applicants
// list or the wishlist (or use the card button). A staged pick is removed
// here via its own remove button. Staged picks keep the full applicant card
// (Review button, status/late/returning/coffee/infosession badges) the whole
// time; that only goes away once a pick is actually confirmed, shown below as
// a plain name + round badge.
// A one-line status header describing where the draft is + why the window is
// (un)locked: a colored dot, a headline, and a sub-line.
function DraftStatus({
  phase,
  isMyTurn,
  currentTurn,
  myPosition,
  nextRound,
}: {
  phase: DraftPhase;
  isMyTurn: boolean;
  currentTurn: CurrentTurn;
  myPosition: MyPosition;
  nextRound: { round_number: number; pick_count: number } | null;
}) {
  let dot = "bg-muted-foreground/40";
  let headline: string;
  let sub: string | null = null;

  if (phase === "not_started") {
    headline = "The draft hasn't started yet";
    sub = "Your draft window unlocks once the draft begins. You can build your wishlist in the meantime.";
  } else if (phase === "complete") {
    dot = "bg-sky-500";
    headline = "The draft is complete";
    sub = "Confirmed picks have been placed on their projects.";
  } else if (isMyTurn && nextRound) {
    dot = "bg-green-500";
    headline = "It's your turn to pick";
    sub = `Submit up to ${nextRound.pick_count} pick${nextRound.pick_count === 1 ? "" : "s"} for Round ${nextRound.round_number}.`;
  } else if (!nextRound) {
    dot = "bg-muted-foreground/40";
    headline = "No more picks for your project";
    sub = currentTurn ? `Currently picking: ${currentTurn.projectName} (Round ${currentTurn.roundNumber}).` : null;
  } else {
    dot = "bg-amber-500";
    headline = currentTurn ? `On the clock: ${currentTurn.projectName}` : "Another project is picking";
    const n = myPosition?.picksUntilTurn ?? 0;
    sub = `${currentTurn ? `Round ${currentTurn.roundNumber}. ` : ""}${
      n <= 0 ? "You're up next." : `${n} pick${n === 1 ? "" : "s"} until your turn.`
    } Stage picks now — you'll submit when it's your turn.`;
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{headline}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

export function DraftWindowPanel({
  appById,
  periodEndsAt,
  onReview,
  phase,
  currentTurn,
  myPosition,
  canStage,
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
  phase: DraftPhase;
  currentTurn: CurrentTurn;
  myPosition: MyPosition;
  // Whether picks can be staged/removed right now (draft running). Submitting
  // is separately gated on isMyTurn.
  canStage: boolean;
  nextRound: { id: string; round_number: number; pick_count: number } | null;
  isMyTurn: boolean;
  draftWindowPicks: PickRow[];
  confirmedPicks: (PickRow & { round: { round_number: number } })[];
  onSubmit: () => Promise<boolean>;
  // Un-stages a pick from the draft window (the applicant stays in the
  // Applicants list regardless). Also used for an orphaned pick -- one whose
  // applicant isn't in the current review
  // list anymore (e.g. they unranked this project, or their status
  // changed) -- which still counts against pick_count on the server, so it
  // must stay visible and removable rather than silently vanishing while
  // still taking up a slot.
  onRemove: (applicationId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: DRAFT_WINDOW_DROPZONE_ID, disabled: !canStage });

  const submit = async () => {
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  const lockedReason =
    phase === "not_started" ? "The draft window unlocks when the draft starts."
    : phase === "complete" ? "The draft is complete."
    : !nextRound ? "Your project has no more picks this draft."
    : null;

  return (
    <>
      <DraftStatus
        phase={phase}
        isMyTurn={isMyTurn}
        currentTurn={currentTurn}
        myPosition={myPosition}
        nextRound={nextRound}
      />

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
            Draft window{canStage && nextRound ? ` (${draftWindowPicks.length}/${nextRound.pick_count})` : ""}
          </h2>
          {phase === "in_progress" && nextRound && (
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={submit}
              disabled={!isMyTurn || draftWindowPicks.length === 0 || submitting}
            >
              {submitting ? "Submitting…" : isMyTurn ? "Submit" : "Not your turn yet"}
            </Button>
          )}
        </div>
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-2 rounded-xl border-2 border-dashed p-3 min-h-[76px] transition-colors ${
            !canStage ? "border-muted-foreground/20 bg-muted/20"
            : isOver ? "border-primary bg-primary/5"
            : "border-muted-foreground/25"
          }`}
        >
          {!canStage ? (
            <div className="flex flex-col items-center gap-1 py-4 text-center">
              <Lock size={15} className="text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{lockedReason ?? "The draft window is locked."}</p>
            </div>
          ) : draftWindowPicks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Drag up to {nextRound!.pick_count} applicants here for Round {nextRound!.round_number}
              {isMyTurn ? "" : " to stage them ahead of your turn"}.
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
                <StaticApplicantCard
                  key={p.id}
                  app={app}
                  periodEndsAt={periodEndsAt}
                  onReview={onReview}
                  onRemove={onRemove}
                />
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
