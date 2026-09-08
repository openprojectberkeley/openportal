"use client";

import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, RotateCcw, Star, UserPlus, X } from "lucide-react";
import { PersonName } from "@/components/person-profile-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReviewStatus } from "@/components/application-review-modal";
import { CoffeeChatIndicator, InfosessionIndicator, LateBadge, type CoffeeState } from "@/components/applicant-indicators";

export type Applicant = { user_id: string; preferred_firstname: string | null; lastname: string | null };

export type AppRow = {
  id: string;
  status: ReviewStatus;
  submitted_at: string | null;
  applicant: Applicant | null;
  coffee: CoffeeState;
  // Hosts this applicant completed (done) or booked (booked) a coffee chat with.
  coffeeWith: string[];
  // Applicant was a member before (status active/inactive) vs. a first-timer.
  returning: boolean;
  // This applicant's rank (1-7) for the currently selected project.
  rank: number;
  // Applicant checked in to at least one info session.
  infosession: boolean;
  // Board/exec, or (coffee done or returning) and attended an info session.
  valid: boolean;
};

export function applicantName(a: AppRow): string {
  return [a.applicant?.preferred_firstname, a.applicant?.lastname].filter(Boolean).join(" ") || "Applicant";
}

// Why an applicant fails recruiting validity — same wording as analytics invalidIssues.
function invalidReasons(app: AppRow): string[] {
  const coffeeOk = app.coffee === "done" || app.returning;
  const issues: string[] = [];
  if (!coffeeOk) issues.push(app.coffee === "booked" ? "Coffee booked (incomplete)" : "No coffee chat");
  if (!app.infosession) issues.push("No info session");
  return issues;
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "accepted") return <Badge className="bg-green-600 hover:bg-green-600">Accepted</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return null;
}

// Small badge marking an applicant who was a member in a previous semester.
function ReturningIndicator({ returning }: { returning: boolean }) {
  if (!returning) return null;
  return (
    <Badge className="gap-1 bg-indigo-600 text-white hover:bg-indigo-600" title="Returning member">
      <RotateCcw size={11} />
      Returning
    </Badge>
  );
}

// Name + status/indicator badges shared by every applicant-card variant
// (Applicants, Wishlist, Draft window).
export function ApplicantMeta({ app, periodEndsAt }: { app: AppRow; periodEndsAt: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <PersonName userId={app.applicant?.user_id} name={applicantName(app)} className="text-sm font-medium truncate" />
      <StatusBadge status={app.status} />
      <ReturningIndicator returning={app.returning} />
      <LateBadge submittedAt={app.submitted_at} endsAt={periodEndsAt} />
      <CoffeeChatIndicator state={app.coffee} withNames={app.coffeeWith} />
      <InfosessionIndicator attended={app.infosession} />
    </div>
  );
}

// Actions an applicant card can carry, independent of how (or whether) the card
// is draggable. The wishlist toggle + "on the wishlist" badge only show on the
// Applicants list; onAddToDraft only when a draft is active; onRemove only on
// the wishlist / draft-window cards.
export type ApplicantCardActions = {
  app: AppRow;
  periodEndsAt: string | undefined;
  onReview: () => void;
  // Applicants-list toggle: add to / remove from this project's wishlist.
  isWishlisted?: boolean;
  onWishlistToggle?: () => void;
  // Stage into the draft window (button peer of dragging one in). Disabled
  // once the applicant is already staged / confirmed.
  onAddToDraft?: () => void;
  addToDraftDisabled?: boolean;
  // Remove from the list this card lives in (wishlist / draft window).
  onRemove?: () => void;
};

// Small helper so a button living on a draggable card doesn't start a drag.
const stopDrag = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
};

// The visible contents of an applicant card: meta + action buttons. Rendered
// inside every wrapper (sortable / draggable / static) so all variants look
// identical and the buttons behave the same.
function ApplicantCardInner({
  app,
  periodEndsAt,
  onReview,
  isWishlisted,
  onWishlistToggle,
  onAddToDraft,
  addToDraftDisabled,
  onRemove,
}: ApplicantCardActions) {
  const invalid = !app.valid;
  const reasons = invalid ? invalidReasons(app) : [];
  return (
    <>
      {invalid && (
        // CSS fallback for the shared <Tooltip> primitive (components/ui/tooltip):
        // dnd-kit listeners on the card block Radix hover-open, and native title
        // never fires while a drag is armed. Styling is kept in sync with TooltipContent.
        <span className="relative shrink-0 group/warn text-red-600 dark:text-red-400" aria-label="Missing recruiting requirements. Can still be drafted into projects.">
          <AlertTriangle size={14} />
          <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-xs -translate-x-1/2 flex-col gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-lg group-hover/warn:flex">
            <span className="font-medium">
              {reasons.length > 0 ? reasons.join(" · ") : "Missing recruiting requirements"}
            </span>
            <span className="opacity-80">Can still be drafted into projects.</span>
          </span>
        </span>
      )}
      <ApplicantMeta app={app} periodEndsAt={periodEndsAt} />
      {onAddToDraft && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs shrink-0"
          onClick={(e) => { e.stopPropagation(); onAddToDraft(); }}
          disabled={addToDraftDisabled}
          title="Add to draft window"
          {...stopDrag}
        >
          <UserPlus size={14} />
        </Button>
      )}
      {onWishlistToggle && (
        <Button
          size="sm"
          variant={isWishlisted ? "secondary" : "outline"}
          className="h-7 px-2 text-xs shrink-0"
          onClick={(e) => { e.stopPropagation(); onWishlistToggle(); }}
          title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
          aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
          {...stopDrag}
        >
          <Star size={14} className={isWishlisted ? "fill-amber-500 text-amber-500" : ""} />
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2.5 text-xs shrink-0"
        onClick={(e) => { e.stopPropagation(); onReview(); }}
        {...stopDrag}
      >
        Review
      </Button>
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Remove"
          {...stopDrag}
        >
          <X size={14} />
        </Button>
      )}
    </>
  );
}

function cardClassName(app: AppRow, opts?: { grab?: boolean; dragClass?: string }): string {
  const invalid = !app.valid;
  return [
    "flex items-center gap-2 border rounded-lg px-3 py-2 select-none",
    invalid
      ? "border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
      : "bg-background",
    opts?.grab ? "cursor-grab active:cursor-grabbing touch-none" : "",
    opts?.dragClass ?? "",
  ].join(" ");
}

// Sortable card for the reorderable Wishlist. The whole card is the drag
// handle; buttons stop propagation so they don't start a drag.
export function SortableApplicantCard({ dndId, ...actions }: ApplicantCardActions & { dndId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dndId });
  // Hidden in place while dragging (the DragOverlay shows the moving copy and
  // the list reflows to open a gap), matching the ranking page.
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 } as React.CSSProperties;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cardClassName(actions.app, { grab: true })}
    >
      <ApplicantCardInner {...actions} />
    </div>
  );
}

// Plain draggable card for the immutable "Applicants" list: it's a copy
// source (dragging it into the wishlist / draft window leaves the original in
// place), so it uses useDraggable rather than useSortable — no sibling reflow,
// the list never reorders. The source stays visible (dimmed) while dragging
// since nothing actually leaves this list.
export function DraggableApplicantCard({ dndId, ...actions }: ApplicantCardActions & { dndId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dndId });
  // No transform on the source: the DragOverlay renders the moving copy, so the
  // original stays put (just dimmed). Applying the pointer transform here would
  // move the card off to the side and widen the page (horizontal scroll).
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cardClassName(actions.app, { grab: true, dragClass: isDragging ? "opacity-40" : "" })}
    >
      <ApplicantCardInner {...actions} />
    </div>
  );
}

// Non-draggable card: draft-window staged picks, and the DragOverlay preview.
export function StaticApplicantCard(actions: ApplicantCardActions) {
  return (
    <div className={cardClassName(actions.app)}>
      <ApplicantCardInner {...actions} />
    </div>
  );
}
