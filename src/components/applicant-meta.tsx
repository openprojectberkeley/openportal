"use client";

import { useDraggable } from "@dnd-kit/core";
import { AlertTriangle, GripVertical, RotateCcw, X } from "lucide-react";
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
// (Left to review, Wishlist, Draft window).
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

// A draggable applicant card: drag handle + full meta + Review action, plus
// an optional Remove (×). This is the one card used for every list an
// applicant can appear in before they're confirmed -- "Left to review",
// Wishlist, and the draft window -- so the same info (status/late/returning/
// coffee/infosession badges + the Review button) stays visible and
// draggable the whole way through. It only goes away once an applicant is
// actually confirmed (drafted), which renders a plain name + round badge
// instead (see DraftWindowPanel's Confirmed section).
export function DraggableApplicantCard({
  app,
  periodEndsAt,
  onReview,
  onRemove,
}: {
  app: AppRow;
  periodEndsAt: string | undefined;
  onReview: () => void;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: app.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const invalid = !app.valid;
  const reasons = invalid ? invalidReasons(app) : [];
  const warningLabel = invalid
    ? `${reasons.length ? reasons.join(". ") : "Missing recruiting requirements"}. Can still be drafted into projects.`
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${
        invalid
          ? "border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
          : "bg-background"
      } ${isDragging ? "relative z-10 opacity-50 shadow-lg" : ""}`}
    >
      {/* CSS tooltip (not HoverCard/title): dnd-kit listeners on the same node
          block Radix hover-open, and native title never fires on drag handles. */}
      <span className="relative shrink-0 group">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className={`cursor-grab touch-none ${
            invalid
              ? "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          }`}
          aria-label={warningLabel ?? "Drag to move"}
        >
          {invalid ? <AlertTriangle size={14} /> : <GripVertical size={14} />}
        </button>
        {invalid && !isDragging && (
          <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[14rem] -translate-x-1/2 flex-col gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-background shadow-lg group-hover:flex">
            {reasons.length > 0 ? (
              <span className="text-[11px] leading-snug font-medium">
                {reasons.join(" · ")}
              </span>
            ) : (
              <span className="text-[11px] leading-snug font-medium">Missing recruiting requirements</span>
            )}
            <span className="text-[11px] leading-snug opacity-80">Can still be drafted into projects.</span>
          </span>
        )}
      </span>
      <ApplicantMeta app={app} periodEndsAt={periodEndsAt} />
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onReview}>
        Review
      </Button>
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
          onClick={onRemove}
          aria-label="Remove"
        >
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
