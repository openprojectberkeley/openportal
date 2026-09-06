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
