"use client";

import { Coffee, Check, Clock, Presentation, FileCheck, AlertTriangle, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
          className={`inline-flex items-center gap-0.5 ${done ? "text-green-600" : "text-amber-600"}`}
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
    <span
      title="Attended an info session"
      aria-label="Attended an info session"
      className="inline-flex items-center gap-0.5 text-sky-600"
    >
      <Presentation size={14} />
      <Check size={12} className="stroke-[3]" />
    </span>
  );
}

// Amber "Late" pill shown when an application was submitted after its period's
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
    <Badge
      className={cn("gap-1 bg-amber-600 text-white hover:bg-amber-600", className)}
      title="Submitted after the period deadline"
    >
      <Clock size={11} />
      Late - {days} {days === 1 ? "day" : "days"}
    </Badge>
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
        <span className="inline-flex items-center text-red-600 dark:text-red-400" aria-label="Missing recruiting requirements">
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
    <span
      title="Submitted an application"
      aria-label="Submitted an application"
      className="inline-flex items-center gap-0.5 text-violet-600"
    >
      <FileCheck size={14} />
    </span>
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
      className="relative shrink-0 group/wish text-amber-500"
      aria-label={label}
    >
      <Star size={14} className="fill-amber-500/80" />
      {projects.length > 1 && (
        <span className="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[8px] font-semibold leading-none text-white">
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
