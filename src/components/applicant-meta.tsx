"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, RotateCcw, Star, UserPlus, X } from "lucide-react";
import { PersonName } from "@/components/person-profile-provider";
import { Badge } from "@/components/ui/badge";
import type { ReviewStatus } from "@/components/application-review-modal";
import { CoffeeChatIndicator, InfosessionIndicator, LateBadge, type CoffeeState } from "@/components/applicant-indicators";
import { rankLabel } from "@/lib/application-rank";

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
  // Board/exec or returning, or coffee done and attended an info session.
  valid: boolean;
};

export function applicantName(a: AppRow): string {
  return [a.applicant?.preferred_firstname, a.applicant?.lastname].filter(Boolean).join(" ") || "Applicant";
}

// Why an applicant fails recruiting validity — same wording as analytics invalidIssues.
function invalidReasons(app: AppRow): string[] {
  if (app.returning) return [];
  const issues: string[] = [];
  if (app.coffee !== "done") issues.push(app.coffee === "booked" ? "Coffee booked (incomplete)" : "No coffee chat");
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
// (Applicants, Wishlist, Draft window). `rank` adds a quiet ordinal ("1st")
// after the name -- used by the wishlist, whose cards have been pulled out of
// their "1st choice"/"2nd choice" heading and would otherwise lose that signal.
export function ApplicantMeta({
  app,
  periodEndsAt,
  rank,
  showRecruitingStatus,
}: {
  app: AppRow;
  periodEndsAt: string | undefined;
  rank?: boolean;
  // Coffee chat + infosession indicators. Off by default so drafting cards stay dense.
  showRecruitingStatus?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <PersonName userId={app.applicant?.user_id} name={applicantName(app)} className="text-sm font-medium truncate" />
      {rank && app.rank > 0 && (
        <span
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70"
          title={rankLabel(app.rank)}
        >
          {rankLabel(app.rank).split(" ")[0]}
        </span>
      )}
      <StatusBadge status={app.status} />
      <ReturningIndicator returning={app.returning} />
      <LateBadge submittedAt={app.submitted_at} endsAt={periodEndsAt} />
      {showRecruitingStatus && (
        <>
          <CoffeeChatIndicator state={app.coffee} withNames={app.coffeeWith} />
          <InfosessionIndicator attended={app.infosession} />
        </>
      )}
    </div>
  );
}

// Actions an applicant card can carry, independent of how (or whether) the card
// is draggable. Callbacks take the app / id (not a pre-bound closure) so callers
// can pass stable references and the cards can be memoized -- important because
// the whole page re-renders on every drag-over frame. Applicants use
// onAddToWishlist (outline star); wishlist uses onWishlistToggle (filled gold
// star); draft window uses onRemove (X).
export type ApplicantCardActions = {
  app: AppRow;
  periodEndsAt: string | undefined;
  onReview: (app: AppRow) => void;
  // Wishlist cards: filled gold star + quiet ordinal for the choice heading
  // they were moved out of.
  isWishlisted?: boolean;
  showRank?: boolean;
  // When true, show coffee chat + infosession indicators on the card.
  showRecruitingStatus?: boolean;
  // Applicants list: the star moves this applicant onto the wishlist. Never set
  // on a wishlist card (those carry onWishlistToggle instead), so it only ever adds.
  onAddToWishlist?: (id: string) => void;
  // Wishlist cards: filled gold star removes from the wishlist (a move back
  // into the choice groups).
  onWishlistToggle?: (id: string) => void;
  // Stage into the draft window. Shown only when a draft is active; disabled
  // once the applicant is already staged / confirmed.
  showAddToDraft?: boolean;
  onAddToDraft?: (id: string) => void;
  addToDraftDisabled?: boolean;
  // Remove from the draft window (X). Not used on wishlist cards.
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
  showRank,
  showRecruitingStatus,
  onAddToWishlist,
  onWishlistToggle,
  showAddToDraft,
  onAddToDraft,
  addToDraftDisabled,
  onRemove,
  draggable,
}: ApplicantCardActions & { draggable?: boolean }) {
  const invalid = !app.valid;
  const reasons = invalid ? invalidReasons(app) : [];
  const hasOverlay = !!(onAddToWishlist || onWishlistToggle || (showAddToDraft && onAddToDraft) || onRemove);
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

      <ApplicantMeta
        app={app}
        periodEndsAt={periodEndsAt}
        rank={showRank}
        showRecruitingStatus={showRecruitingStatus}
      />

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
          {onAddToWishlist && (
            <OverlayButton
              onClick={() => onAddToWishlist(app.id)}
              label="Add to wishlist"
              className="hover:text-amber-500"
            >
              <Star size={14} />
            </OverlayButton>
          )}
          {onWishlistToggle && (
            <OverlayButton
              onClick={() => onWishlistToggle(app.id)}
              label="Remove from wishlist"
              className="text-amber-500 hover:text-amber-600"
            >
              <Star size={14} className="fill-amber-500" />
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

function cardClassName(app: AppRow, opts?: { grab?: boolean; dragClass?: string }): string {
  const invalid = !app.valid;
  return [
    "group relative flex items-center gap-2 border rounded-lg px-3 py-2 select-none transition-colors cursor-pointer",
    invalid
      ? "border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
      : "bg-background",
    opts?.grab ? "active:cursor-grabbing touch-none" : "",
    opts?.dragClass ?? "",
  ].join(" ");
}

// The one sortable card, shared by the wishlist and the choice groups so the two
// match in size / border / structure and drag between each other seamlessly --
// same arrangement as ProjectCard on the application ranking page. The sortable
// id is the raw application id (no per-zone prefix): an applicant is in exactly
// one of the two lists at a time, so the card re-parents between the two
// SortableContexts on a move instead of unmounting and re-mounting under a new
// id. Which zone it's in is decided by the page's live wishlist array.
// The whole card is the drag handle; clicking (without dragging) opens review,
// buttons stop propagation.
export const SortableApplicantCard = memo(function SortableApplicantCard(actions: ApplicantCardActions) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: actions.app.id });
  // Hidden in place while dragging. Because the card keeps its id across the
  // move, isDragging stays true once it re-mounts in the other list -- so the
  // card-sized gap it leaves there IS the insertion preview; there's no separate
  // placeholder element. Matches the ranking page.
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 } as React.CSSProperties;
  return (
    <div
      ref={setNodeRef}
      data-app-id={actions.app.id}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => actions.onReview(actions.app)}
      className={cardClassName(actions.app, { grab: true })}
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
      data-app-id={actions.app.id}
      onClick={() => actions.onReview(actions.app)}
      className={cardClassName(actions.app)}
    >
      <ApplicantCardInner {...actions} draggable={draggable} />
    </div>
  );
});
