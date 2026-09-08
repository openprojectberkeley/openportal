"use client";

import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, RotateCcw, Star, UserPlus, X } from "lucide-react";
import { PersonName } from "@/components/person-profile-provider";
import { Badge } from "@/components/ui/badge";
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
// is draggable. Callbacks take the app / id (not a pre-bound closure) so callers
// can pass stable references and the cards can be memoized -- important because
// the whole page re-renders on every drag-over frame. The wishlist toggle (with
// its gold ring + persistent star) only shows on the Applicants list; the draft
// button only when a draft is active; onRemove only on wishlist / draft cards.
export type ApplicantCardActions = {
  app: AppRow;
  periodEndsAt: string | undefined;
  onReview: (app: AppRow) => void;
  // Applicants list: gold ring + a persistent star; the star toggles wishlist.
  isWishlisted?: boolean;
  onWishlistToggle?: (id: string) => void;
  // Stage into the draft window. Shown only when a draft is active; disabled
  // once the applicant is already staged / confirmed.
  showAddToDraft?: boolean;
  onAddToDraft?: (id: string) => void;
  addToDraftDisabled?: boolean;
  // Remove from the list this card lives in (wishlist / draft window).
  onRemove?: (id: string) => void;
};

// Small helper so a button living on a draggable card doesn't start a drag,
// and clicking it doesn't bubble up to the card's open-review click.
const stopClick = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
};

// An overlay action button (revealed on hover inside the gradient panel).
function OverlayButton({
  onClick,
  disabled,
  label,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent ${className ?? ""}`}
      onPointerDown={stopClick.onPointerDown}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
    >
      {children}
    </button>
  );
}

// The visible contents of an applicant card: a drag affordance, meta, and a
// hover overlay of actions. Rendered inside every wrapper (sortable /
// draggable / static). The overlay is absolutely positioned so the buttons
// take no layout width -- they fade in over a gradient that veils the labels
// behind them. Clicking the card (anywhere but a button) opens review.
function ApplicantCardInner({
  app,
  periodEndsAt,
  isWishlisted,
  onWishlistToggle,
  showAddToDraft,
  onAddToDraft,
  addToDraftDisabled,
  onRemove,
  draggable,
}: ApplicantCardActions & { draggable?: boolean }) {
  const invalid = !app.valid;
  const reasons = invalid ? invalidReasons(app) : [];
  const hasOverlay = !!(onWishlistToggle || (showAddToDraft && onAddToDraft) || onRemove);
  return (
    <>
      {invalid ? (
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
      ) : draggable ? (
        <GripVertical size={14} className="shrink-0 text-muted-foreground/40" aria-hidden />
      ) : null}

      <ApplicantMeta app={app} periodEndsAt={periodEndsAt} />

      {/* Persistent wishlisted indicator; sits in the same 28px box (and card
          padding) as the overlay's star toggle so the two line up exactly, and
          fades out as the overlay fades in. */}
      {isWishlisted && onWishlistToggle && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center text-amber-500 transition-opacity group-hover:opacity-0" aria-hidden>
          <Star size={14} className="fill-amber-500" />
        </span>
      )}

      {hasOverlay && (
        <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-lg pl-10 pr-3 bg-gradient-to-l from-background via-background/95 to-transparent opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
          {showAddToDraft && onAddToDraft && (
            <OverlayButton
              onClick={() => onAddToDraft(app.id)}
              disabled={addToDraftDisabled}
              label="Add to draft window"
              className="hover:text-foreground"
            >
              <UserPlus size={14} />
            </OverlayButton>
          )}
          {onWishlistToggle && (
            <OverlayButton
              onClick={() => onWishlistToggle(app.id)}
              label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
              className={isWishlisted ? "text-amber-500 hover:text-amber-600" : "hover:text-amber-500"}
            >
              <Star size={14} className={isWishlisted ? "fill-amber-500" : ""} />
            </OverlayButton>
          )}
          {onRemove && (
            <OverlayButton
              onClick={() => onRemove(app.id)}
              label="Remove"
              className="hover:text-destructive"
            >
              <X size={14} />
            </OverlayButton>
          )}
        </div>
      )}
    </>
  );
}

function cardClassName(app: AppRow, opts?: { grab?: boolean; dragClass?: string; wishlisted?: boolean }): string {
  const invalid = !app.valid;
  return [
    "group relative flex items-center gap-2 border rounded-lg px-3 py-2 select-none transition-colors cursor-pointer",
    invalid
      ? "border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
      : opts?.wishlisted
        ? "border-amber-400/70 ring-1 ring-amber-400/50 bg-amber-50/40 dark:bg-amber-950/10"
        : "bg-background",
    opts?.grab ? "active:cursor-grabbing touch-none" : "",
    opts?.dragClass ?? "",
  ].join(" ");
}

// Sortable card for the reorderable Wishlist. The whole card is the drag
// handle; clicking (without dragging) opens review, buttons stop propagation.
export const SortableApplicantCard = memo(function SortableApplicantCard({
  dndId,
  ...actions
}: ApplicantCardActions & { dndId: string }) {
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
      onClick={() => actions.onReview(actions.app)}
      className={cardClassName(actions.app, { grab: true, wishlisted: actions.isWishlisted })}
    >
      <ApplicantCardInner {...actions} draggable />
    </div>
  );
});

// Plain draggable card for the immutable "Applicants" list: it's a copy
// source (dragging it into the wishlist / draft window leaves the original in
// place), so it uses useDraggable rather than useSortable — no sibling reflow,
// the list never reorders. The source stays visible (dimmed) while dragging
// since nothing actually leaves this list. Memoized so a wishlist drag (which
// re-renders the page every frame) doesn't re-render the whole Applicants list.
export const DraggableApplicantCard = memo(function DraggableApplicantCard({
  dndId,
  ...actions
}: ApplicantCardActions & { dndId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dndId });
  // No transform on the source: the DragOverlay renders the moving copy, so the
  // original stays put (just dimmed). Applying the pointer transform here would
  // move the card off to the side and widen the page (horizontal scroll).
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => actions.onReview(actions.app)}
      className={cardClassName(actions.app, { grab: true, wishlisted: actions.isWishlisted, dragClass: isDragging ? "opacity-40" : "" })}
    >
      <ApplicantCardInner {...actions} draggable />
    </div>
  );
});

// Non-draggable card: draft-window staged picks, and the DragOverlay preview
// (which passes `draggable` so the preview keeps the grip). Clicking opens review.
export const StaticApplicantCard = memo(function StaticApplicantCard({
  draggable,
  ...actions
}: ApplicantCardActions & { draggable?: boolean }) {
  return (
    <div
      onClick={() => actions.onReview(actions.app)}
      className={cardClassName(actions.app, { wishlisted: actions.isWishlisted })}
    >
      <ApplicantCardInner {...actions} draggable={draggable} />
    </div>
  );
});
