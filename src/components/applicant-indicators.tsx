"use client";

import { Coffee, Check, Clock, Presentation, FileCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn, isLate, daysLate } from "@/lib/utils";
import { coffeeChatLabel, type CoffeeState } from "@/lib/coffee-chat-indicator";

export type { CoffeeState } from "@/lib/coffee-chat-indicator";
export { coffeeChatLabel, coffeeWithByApplicant } from "@/lib/coffee-chat-indicator";

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
    <HoverCard openDelay={100} closeDelay={50}>
      <HoverCardTrigger asChild>
        <span
          aria-label={label}
          className={`inline-flex items-center gap-0.5 ${done ? "text-green-600" : "text-amber-600"}`}
        >
          <Coffee size={14} />
          {done ? <Check size={12} className="stroke-[3]" /> : <Clock size={12} />}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        className="w-auto max-w-[16rem] px-2.5 py-1.5 text-xs leading-snug"
      >
        {label}
      </HoverCardContent>
    </HoverCard>
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
