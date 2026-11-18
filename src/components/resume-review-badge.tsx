"use client";

import { createClient } from "@/lib/supabase/client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useRoleSim } from "@/components/role-simulation-provider";

// Pending resume reviews for people who can review them (exec). Null for
// everyone else, so callers render nothing. Refetches on navigation so the
// navbar's count drops after working the queue.
export function usePendingResumeReviewCount(): number | null {
  const { isExec } = useRoleSim();
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isExec) {
      setCount(null);
      return;
    }
    let cancelled = false;
    createClient()
      .from("resume_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => {
        if (!cancelled) setCount(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [isExec, pathname]);

  return count;
}

// Red count bubble, same look as the notification bell's. Position it with
// `className` (the parent must be `relative`), or pass `inline` to sit it in
// the text flow (a tab label).
export function CountBadge({
  count,
  size = "sm",
  inline = false,
  className = "",
}: {
  count: number | null;
  size?: "sm" | "md";
  inline?: boolean;
  className?: string;
}) {
  if (!count) return null;
  const sizing = size === "md" ? "min-w-[1.375rem] h-[1.375rem] px-1.5 text-xs" : "min-w-[1rem] h-4 px-1 text-[10px]";
  return (
    <span
      key={count}
      aria-label={`${count} waiting for review`}
      className={`${inline ? "ml-1.5 inline-flex align-middle" : "absolute z-40 flex"} ${sizing} rounded-full tabular-nums animate-pop bg-destructive text-destructive-foreground font-semibold leading-none items-center justify-center pointer-events-none ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
