"use client";

import { Coffee, Check, Clock, Presentation, FileCheck, FileQuestion, AlertTriangle, Star } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, isLate, daysLate } from "@/lib/utils";
import { coffeeChatLabel, type CoffeeState } from "@/lib/coffee-chat-indicator";
import { DEFAULT_ACCENT } from "@/lib/portal-color";

export type { CoffeeState } from "@/lib/coffee-chat-indicator";
export { coffeeChatLabel, coffeeWithByApplicant } from "@/lib/coffee-chat-indicator";

// A project that has shortlisted an applicant (other than the viewer's current
// project). Used by WishlistedByIndicator.
export type WishlistProject = { id: string; name: string; color: string | null };

// Coffee cup with a check once the applicant has completed a chat, a clock while
// one is only booked, and nothing if they've never booked (or the value is
// absent — e.g. a viewer who isn't an application manager).
export function CoffeeChatIndicator({
  state,
  withNames,
}: {
  state?: CoffeeState | null;
  withNames?: string[] | null;
}) {
  if (!state || state === "none") return null;
  const done = state === "done";
  const label = coffeeChatLabel(state, withNames);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={label}
          className={`inline-flex items-center gap-0.5 ${done ? "text-success" : "text-warning"}`}
        >
          <Coffee size={14} />
          {done ? <Check size={12} className="stroke-[3]" /> : <Clock size={12} />}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// Presentation icon with a check once the applicant has checked in to an info
// session; nothing if they never attended one (or the value is absent).
export function InfosessionIndicator({ attended }: { attended?: boolean | null }) {
  if (!attended) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label="Attended an info session" className="inline-flex items-center gap-0.5 text-info">
          <Presentation size={14} />
          <Check size={12} className="stroke-[3]" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Attended an info session</TooltipContent>
    </Tooltip>
  );
}

// Slate "No application" pill for someone an exec added to the draft board
// directly (applications.exec_added, 0096). Their card has no rank, no essays
// and no answers -- this says why, so an empty review sheet doesn't read as a
// loading bug. Renders null for everyone else, so it can sit in a badge cluster
// unconditionally.
export function NoApplicationIndicator({ execAdded }: { execAdded?: boolean | null }) {
  if (!execAdded) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label="No application"
          className="inline-flex shrink-0 items-center text-muted-foreground"
        >
          <FileQuestion size={13} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem]">
        Added to the draft by an exec. They never submitted a written application, so there are no
        rankings or essays to review.
      </TooltipContent>
    </Tooltip>
  );
}

// Amber clock + "Nd late" (text, not a pill) when an application was submitted after its period's
// deadline (ends_at); nothing otherwise. Renders null unless the submission is
// actually late, so callers can drop it into a badge cluster unconditionally.
export function LateBadge({
  submittedAt,
  endsAt,
  className,
}: {
  submittedAt?: string | null;
  endsAt?: string | null;
  className?: string;
}) {
  if (!isLate(submittedAt, endsAt)) return null;
  const days = daysLate(submittedAt, endsAt);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-warning", className)}>
          <Clock size={11} aria-hidden />
          {days}d late
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Submitted {days} {days === 1 ? "day" : "days"} after the period deadline</TooltipContent>
    </Tooltip>
  );
}

// Red warning triangle when an applicant hasn't met recruiting requirements
// (valid === false). Renders nothing when valid or when validity is unknown,
// so callers can drop it into a badge cluster unconditionally.
export function InvalidIndicator({ valid }: { valid?: boolean | null }) {
  if (valid !== false) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center text-destructive" aria-label="Missing recruiting requirements">
          <AlertTriangle size={14} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Missing recruiting requirements. Can still be drafted.</TooltipContent>
    </Tooltip>
  );
}

// File-with-check icon once the person has a submitted (non-draft) application in
// the current application period; nothing otherwise (or when the value is absent,
// e.g. a viewer who isn't an application manager).
export function SubmittedApplicationIndicator({ submitted }: { submitted?: boolean | null }) {
  if (!submitted) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label="Submitted an application" className="inline-flex items-center gap-0.5 text-info">
          <FileCheck size={14} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Submitted an application</TooltipContent>
    </Tooltip>
  );
}

// Amber star when other projects have shortlisted this applicant. Uses a CSS
// hover tooltip (not Radix) so it still opens on dnd-kit draggable cards — same
// pattern as the invalid-applicant warning in applicant-meta.
export function WishlistedByIndicator({ projects }: { projects?: WishlistProject[] | null }) {
  if (!projects?.length) return null;
  const label =
    projects.length === 1
      ? `Wishlisted by ${projects[0].name}`
      : `Wishlisted by ${projects.length} projects`;
  return (
    <span
      className="relative shrink-0 group/wish text-warning"
      aria-label={label}
    >
      <Star size={14} className="fill-warning/80" />
      {projects.length > 1 && (
        <span className="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-warning px-0.5 text-[8px] font-semibold tabular-nums leading-none text-warning-foreground">
          {projects.length}
        </span>
      )}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[14rem] -translate-x-1/2 flex-col gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-lg group-hover/wish:flex">
        <span className="font-medium opacity-80">Wishlisted by</span>
        {projects.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: p.color || DEFAULT_ACCENT }}
              aria-hidden
            />
            {p.name}
          </span>
        ))}
      </span>
    </span>
  );
}
