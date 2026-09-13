"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, RotateCcw, Star, UserPlus, X } from "lucide-react";
import { PersonName } from "@/components/person-profile-provider";
import { Badge } from "@/components/ui/badge";
import type { ReviewStatus } from "@/components/application-review-modal";
import { CoffeeChatIndicator, InfosessionIndicator, LateBadge, WishlistedByIndicator, type CoffeeState, type WishlistProject } from "@/components/applicant-indicators";
import { rankLabel } from "@/lib/application-rank";
import { accentStyle } from "@/lib/portal-color";

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
  // Other projects that have shortlisted this applicant (excludes the viewer's
  // currently selected project). Empty when nobody else has them wishlisted.
  wishlistedBy: WishlistProject[];
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
  if (status === "accepted") return <Badge className="shrink-0 bg-green-600 hover:bg-green-600">Accepted</Badge>;
  if (status === "rejected") return <Badge variant="destructive" className="shrink-0">Rejected</Badge>;
  return null;
}

// Small badge marking an applicant who was a member in a previous semester.
export function ReturningIndicator({ returning }: { returning: boolean }) {
  if (!returning) return null;
  return (
    <Badge className="shrink-0 gap-1 bg-indigo-600 text-white hover:bg-indigo-600" title="Returning member">
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
  compact,
  hideStatus,
}: {
  app: AppRow;
  periodEndsAt: string | undefined;
  rank?: boolean;
  // Coffee chat + infosession indicators. Off by default so drafting cards stay dense.
  showRecruitingStatus?: boolean;
  // Drop the Accepted/Rejected badge. For a card that already carries the same
  // word somewhere else -- the draft board's outcome chip -- so the two don't
  // say it twice.
  hideStatus?: boolean;
  // Dense one-line variant (the exec draft board's 300px columns): returning /
  // late move in behind showRecruitingStatus so the row only ever carries the
  // name, its status, and whatever the viewer explicitly asked to see.
  compact?: boolean;
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
      {!hideStatus && <StatusBadge status={app.status} />}
      {!compact && (
        <>
          <ReturningIndicator returning={app.returning} />
          <LateBadge submittedAt={app.submitted_at} endsAt={periodEndsAt} />
        </>
      )}
      <WishlistedByIndicator projects={app.wishlistedBy} />
      {showRecruitingStatus && (
        <>
          {compact && (
            <>
              <ReturningIndicator returning={app.returning} />
              <LateBadge submittedAt={app.submitted_at} endsAt={periodEndsAt} />
            </>
          )}
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
  // Draft state, painted so a card in the Applicants column matches the panel
  // its applicant is sitting in. `accent` is the project's colour for a
  // confirmed pick (a runtime hex, so it lands as an inline style); `staged`
  // is the draft window's white, which is a theme token and so stays classes.
  // Both take precedence over the invalid-applicant red tint -- the warning
  // triangle is driven separately off app.valid, so it survives the override.
  accent?: string | null;
  staged?: boolean;
  // Another project already confirmed this applicant (0088). Grays the card
  // and shows "Claimed by …"; mutually exclusive with accent/staged for the
  // viewer's project (own confirms use accent instead).
  claimedBy?: string | null;
  // One-shot sweep across the card, played as an applicant's accent lands (see
  // the shimmer keyframe in tailwind.config.ts).
  shimmer?: boolean;
  // Pairs this card with the row it morphs into elsewhere in the tree during a
  // view transition. Must be unique per document while the transition runs.
  viewTransitionName?: string;
  // Dense one-line variant -- tighter padding, and returning/late badges only
  // when showRecruitingStatus is on. Used by the exec draft board's narrow
  // columns; every other list keeps the roomier default.
  compact?: boolean;
  // Extra control rendered inside the hover overlay, ahead of the buttons (the
  // draft board's outcome / move-to menu). It inherits the overlay's gradient
  // veil, so it costs the card no layout width. Anything interactive in here
  // must stop propagation -- the card root's onClick opens review.
  overlayExtra?: React.ReactNode;
  // Pull `overlayExtra` out of the hover overlay and into the card's own row,
  // at its right edge, visible at rest. For a control that IS the card's
  // resting state rather than an action on it -- the draft board pins the
  // outcome chip once an applicant has answered, in place of the status badge
  // `hideStatus` then drops. Assumes the card carries no other overlay action
  // (the board's don't): those still live under the veil, which would cover a
  // pinned control on hover.
  pinExtra?: boolean;
  // Drop the card's own Accepted/Rejected badge -- see ApplicantMeta.
  hideStatus?: boolean;
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
  compact,
  overlayExtra,
  pinExtra,
  hideStatus,
  shimmer,
  claimedBy,
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
  const claimed = !!claimedBy;
  // A pinned extra sits in the row instead of the overlay, so on a card whose
  // only overlay content was that extra there is no overlay left to build.
  const pinned = !!(pinExtra && overlayExtra);
  // Claimed applicants can't be drafted, but wishlist add/remove still works.
  const hasOverlay = !!(
    (!pinned && overlayExtra)
    || onAddToWishlist
    || onWishlistToggle
    || (!claimed && showAddToDraft && onAddToDraft)
    || onRemove
  );
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

      <div className={`min-w-0 flex-1 ${claimed ? "opacity-50" : ""}`}>
        <ApplicantMeta
          app={app}
          periodEndsAt={periodEndsAt}
          rank={showRank}
          showRecruitingStatus={showRecruitingStatus}
          compact={compact}
          hideStatus={hideStatus}
        />
      </div>

      {claimed && (
        <span className={`shrink-0 text-[11px] italic text-muted-foreground ${hasOverlay ? "transition-opacity group-hover:opacity-0" : ""}`}>
          Claimed by {claimedBy}
        </span>
      )}

      {/* Persistent wishlisted indicator; sits in the same 28px box (and card
          padding) as the overlay's star toggle so the two line up exactly, and
          fades out as the overlay fades in. */}
      {isWishlisted && onWishlistToggle && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center text-amber-500 transition-opacity group-hover:opacity-0" aria-hidden>
          <Star size={14} className="fill-amber-500" />
        </span>
      )}

      {/* Always-visible control at the card's right edge, where the overlay
          would have put it -- but in flow, so the name truncates against it
          instead of sliding underneath. */}
      {pinned && <div className="shrink-0">{overlayExtra}</div>}

      {/* Its own clipping wrapper rather than overflow-hidden on the card root,
          which would also clip the invalid-applicant tooltip above the card. */}
      {shimmer && (
        <span
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg motion-reduce:hidden"
          aria-hidden
        >
          <span className="absolute inset-y-0 -left-1/3 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-foreground/15 to-transparent" />
        </span>
      )}

      {hasOverlay && (
        // has-[[data-state=open]] keeps the veil (and its contents) up while a
        // menu opened from inside it is still open -- otherwise moving the
        // pointer to the menu fades the trigger out from under it.
        <div className={`absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-lg ${compact ? "pl-8 pr-2.5" : "pl-10 pr-3"} bg-gradient-to-l from-background via-background/95 to-transparent opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto`}>
          {overlayExtra}
          {!claimed && showAddToDraft && onAddToDraft && (
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

function cardClassName(
  app: AppRow,
  opts?: {
    grab?: boolean;
    dragClass?: string;
    tint?: "accent" | "staged" | "claimed";
    shimmer?: boolean;
    compact?: boolean;
  },
): string {
  const invalid = !app.valid;
  return [
    "group relative flex items-center border rounded-lg select-none transition-colors cursor-pointer",
    opts?.compact ? "gap-1.5 px-2.5 py-1" : "gap-2 px-3 py-2",
    // A tinted card drops both the normal and the invalid-red background rather
    // than fighting them: "accent" is painted by an inline style, "staged"
    // by the card token below. --card is only a shade off --background in light
    // mode and identical in dark, so the outline is what actually carries the
    // signal -- it has to stay visible in both themes.
    opts?.tint === "accent"
      ? ""
      : opts?.tint === "staged"
      ? "bg-card border-foreground/30"
      : opts?.tint === "claimed"
      ? "bg-muted/40 border-muted-foreground/20"
      : invalid
      ? "border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
      : "bg-background",
    // Only while the sweep plays -- a longer transition-colors on every card
    // would make ordinary hover feedback sluggish.
    opts?.shimmer ? "duration-500" : "",
    opts?.grab ? "active:cursor-grabbing touch-none" : "",
    opts?.dragClass ?? "",
  ].join(" ");
}

// A confirmed pick's accent wins over the draft window's white if an applicant
// somehow reads as both (they shouldn't -- confirming takes them out of the
// window). Claimed-by-other is only used when this project hasn't staged/
// confirmed them.
function cardTint(actions: ApplicantCardActions): "accent" | "staged" | "claimed" | undefined {
  if (actions.accent) return "accent";
  if (actions.staged) return "staged";
  if (actions.claimedBy) return "claimed";
  return undefined;
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
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
    viewTransitionName: actions.viewTransitionName,
    ...accentStyle(actions.accent),
  } as React.CSSProperties;
  return (
    <div
      ref={setNodeRef}
      data-app-id={actions.app.id}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => actions.onReview(actions.app)}
      className={cardClassName(actions.app, {
        grab: true,
        tint: cardTint(actions),
        shimmer: actions.shimmer,
        compact: actions.compact,
      })}
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
      style={{ viewTransitionName: actions.viewTransitionName, ...accentStyle(actions.accent) }}
      onClick={() => actions.onReview(actions.app)}
      className={cardClassName(actions.app, {
        tint: cardTint(actions),
        shimmer: actions.shimmer,
        compact: actions.compact,
      })}
    >
      <ApplicantCardInner {...actions} draggable={draggable} />
    </div>
  );
});
