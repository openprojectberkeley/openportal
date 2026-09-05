import { Coffee, Check, Clock, Presentation, FileCheck } from "lucide-react";

// Coffee-chat progress for an applicant: "done" once any chat is completed,
// "booked" while one is booked but not yet completed, "none" if never booked.
export type CoffeeState = "done" | "booked" | "none";

// Coffee cup with a check once the applicant has completed a chat, a clock while
// one is only booked, and nothing if they've never booked (or the value is
// absent — e.g. a viewer who isn't an application manager).
export function CoffeeChatIndicator({ state }: { state?: CoffeeState | null }) {
  if (!state || state === "none") return null;
  const done = state === "done";
  return (
    <span
      title={done ? "Completed a coffee chat" : "Coffee chat booked"}
      aria-label={done ? "Completed a coffee chat" : "Coffee chat booked"}
      className={`inline-flex items-center gap-0.5 ${done ? "text-green-600" : "text-amber-600"}`}
    >
      <Coffee size={14} />
      {done ? <Check size={12} className="stroke-[3]" /> : <Clock size={12} />}
    </span>
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
