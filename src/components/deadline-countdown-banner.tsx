"use client";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type OpenPeriod = { id: string; name: string; ends_at: string };

// Breaks a positive millisecond remainder into whole d/h/m/s segments.
function splitRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function Segment({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className="font-mono text-2xl font-semibold tabular-nums sm:text-3xl">
        {String(value).padStart(2, "0")}
      </span>
      <span className="mt-1 text-[0.625rem] font-medium uppercase tracking-wider opacity-70">
        {label}
      </span>
    </div>
  );
}

/**
 * Full-width, high-contrast countdown to the open application period's
 * `ends_at`, rendered directly below the header on applicant-facing pages.
 *
 * Informational only: `status` (not `ends_at`) is what actually gates whether
 * applications are open (see migration 0023), so hitting zero does not close
 * anything. The banner hides on manager routes, when there is no open period,
 * and once the deadline has passed.
 */
export function DeadlineCountdownBanner() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [period, setPeriod] = useState<OpenPeriod | null>(null);
  // Starts at 0 (stable for prerender); the real clock is read after mount to
  // avoid Next's non-deterministic `Date.now()`-during-render warning.
  const [now, setNow] = useState(0);

  const onManager = pathname?.startsWith("/manager") ?? false;

  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
  }, []);

  // Fetch the current open period (mirrors the query in application/page.tsx,
  // plus name + ends_at). Skipped on manager routes.
  useEffect(() => {
    if (onManager) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("application_periods")
        .select("id, name, ends_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled) setPeriod((data?.[0] as OpenPeriod) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [onManager]);

  // Tick once a second only while there is a deadline to count down to.
  useEffect(() => {
    if (!period) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [period]);

  const remainingMs = useMemo(() => {
    if (!period) return 0;
    return new Date(period.ends_at).getTime() - now;
  }, [period, now]);

  if (!mounted || onManager || !period || remainingMs <= 0) return null;

  const { days, hours, minutes, seconds } = splitRemaining(remainingMs);

  return (
    <div className={cn("w-full bg-foreground text-background")}>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-6 sm:flex-row">
        <div className="flex flex-col text-center sm:text-left">
          <span className="text-xs font-medium uppercase tracking-wider opacity-70">
            {period.name}
          </span>
          <span className="text-base font-semibold sm:text-lg">
            Applications close in
          </span>
        </div>
        <div className="flex items-start gap-4 sm:gap-6">
          <Segment value={days} label="Days" />
          <Segment value={hours} label="Hours" />
          <Segment value={minutes} label="Minutes" />
          <Segment value={seconds} label="Seconds" />
        </div>
      </div>
    </div>
  );
}
