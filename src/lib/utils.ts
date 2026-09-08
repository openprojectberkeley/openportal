import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// An application is "late" when it was submitted after its period's deadline
// (ends_at). Compares against the deadline only — a period can stay open past
// ends_at via its status flag, but a submission after ends_at is still late.
export function isLate(submittedAt?: string | null, endsAt?: string | null): boolean {
  return (
    !!submittedAt &&
    !!endsAt &&
    new Date(submittedAt).getTime() > new Date(endsAt).getTime()
  );
}

// How many days past the deadline a submission was, rounded up so any lateness
// counts as at least one day (day 1 = the first 24h after ends_at). Returns 0
// when not late (or when either timestamp is missing).
export function daysLate(submittedAt?: string | null, endsAt?: string | null): number {
  if (!isLate(submittedAt, endsAt)) return 0;
  const ms = new Date(submittedAt!).getTime() - new Date(endsAt!).getTime();
  return Math.ceil(ms / 86_400_000);
}

export type ReviewPriorityFields = {
  returning: boolean;
  submittedAt?: string | null;
  // Recruiting-valid (coffee/info, or board/exec). Missing treated as valid so
  // older call sites keep working; pass false to sink invalid below late.
  valid?: boolean;
};

// PM review order within a rank: returning members first, then on-time, then
// late, then invalid last. Returning wins over late/invalid; late still beats
// invalid. Same-bucket ties keep earliest submitted_at first.
export function compareReviewPriority(
  a: ReviewPriorityFields,
  b: ReviewPriorityFields,
  endsAt?: string | null,
): number {
  if (a.returning !== b.returning) return a.returning ? -1 : 1;
  const aValid = a.valid !== false;
  const bValid = b.valid !== false;
  if (aValid !== bValid) return aValid ? -1 : 1;
  const aLate = isLate(a.submittedAt, endsAt);
  const bLate = isLate(b.submittedAt, endsAt);
  if (aLate !== bLate) return aLate ? 1 : -1;
  const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity;
  const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity;
  return aTime - bTime;
}
