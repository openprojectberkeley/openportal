"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readableTextColor } from "@/lib/portal-color";
import { cn } from "@/lib/utils";
import type { Announcement } from "@/lib/announcements";

// Site-wide bands under the header: live announcements and the application
// deadline countdown, in one style. Full size they sit in the page flow and
// scroll away; once they've slid under the header, a slim docked copy hangs off
// the header's bottom edge. The docked copy is absolutely positioned, so
// docking never shifts the page.

type OpenPeriod = { id: string; name: string; ends_at: string };

type BannerState = {
  announcements: Announcement[];
  period: OpenPeriod | null;
  now: number;
  docked: boolean;
  setDocked: (v: boolean) => void;
  setOnManager: (v: boolean) => void;
};

const BannerContext = createContext<BannerState | null>(null);

export function HeaderBannersProvider({ children }: { children: React.ReactNode }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [period, setPeriod] = useState<OpenPeriod | null>(null);
  // 0 until mounted: reading the clock during render trips Next's prerender check.
  const [now, setNow] = useState(0);
  const [docked, setDocked] = useState(false);
  // Set by BannerRouteSync (usePathname needs a Suspense boundary, and this
  // provider wraps the navbar, which must not suspend).
  const [onManager, setOnManager] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const iso = new Date().toISOString();
    setNow(Date.now());
    supabase
      .from("announcements")
      .select("id, message, color, starts_at, ends_at, countdown_at")
      .lte("starts_at", iso)
      .gte("ends_at", iso)
      .order("starts_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setAnnouncements((data as Announcement[]) ?? []);
      });
    // Informational only: `status`, not `ends_at`, gates applications (0023),
    // so reaching zero closes nothing — the band just goes away.
    supabase
      .from("application_periods")
      .select("id, name, ends_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setPeriod((data?.[0] as OpenPeriod) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tick once a second only while something is counting down.
  const ticking = !!period || announcements.some((a) => a.countdown_at);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  // The countdown is applicant-facing; managers don't need it on their pages.
  const livePeriod = !onManager && period && now > 0 && new Date(period.ends_at).getTime() > now ? period : null;

  const value = useMemo(
    () => ({ announcements, period: livePeriod, now, docked, setDocked, setOnManager }),
    [announcements, livePeriod, now, docked],
  );
  return <BannerContext.Provider value={value}>{children}</BannerContext.Provider>;
}

/** Feeds the route into the provider. Render inside a Suspense boundary. */
export function BannerRouteSync() {
  const pathname = usePathname();
  const ctx = useContext(BannerContext);
  const setOnManager = ctx?.setOnManager;
  useEffect(() => {
    setOnManager?.(pathname?.startsWith("/manager") ?? false);
  }, [pathname, setOnManager]);
  return null;
}

export function splitRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export const pad = (n: number) => String(n).padStart(2, "0");

/** Milliseconds left until `iso`, or 0 if it's passed / unset / clock not read yet. */
function remaining(iso: string | null | undefined, now: number) {
  if (!iso || now <= 0) return 0;
  return Math.max(0, new Date(iso).getTime() - now);
}

// One band: full width, solid fill, content on the page's max-w-6xl column.
function Band({
  bg,
  fg,
  compact,
  className,
  children,
}: {
  bg: string;
  fg: string;
  compact: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("w-full", className)} style={{ backgroundColor: bg, color: fg }}>
      <div
        className={cn(
          "mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5",
          compact ? "min-h-10 py-1.5" : "flex-col py-5 sm:flex-row",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium uppercase tracking-wider opacity-70">{children}</span>;
}

function AnnouncementBand({ a, now, compact }: { a: Announcement; now: number; compact: boolean }) {
  const fg = readableTextColor(a.color);
  const left = remaining(a.countdown_at, now);
  return (
    <Band bg={a.color} fg={fg} compact={compact}>
      {compact ? (
        <>
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <Megaphone size={14} className="shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{a.message}</span>
          </p>
          {left > 0 && <InlineTimer ms={left} />}
        </>
      ) : (
        <>
          <div className={cn("flex flex-col gap-1 text-center sm:text-left", left > 0 ? "min-w-0" : "w-full")}>
            <Eyebrow>
              <span className="inline-flex items-center gap-1.5">
                <Megaphone size={12} aria-hidden /> Announcement
              </span>
            </Eyebrow>
            <p className="whitespace-pre-line break-words text-base font-semibold sm:text-lg">{a.message}</p>
          </div>
          {left > 0 && <Segments ms={left} />}
        </>
      )}
    </Band>
  );
}

function Segment({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className="font-mono text-2xl font-semibold tabular-nums sm:text-3xl">{pad(value)}</span>
      <span className="mt-1 text-[0.625rem] font-medium uppercase tracking-wider opacity-70">{label}</span>
    </div>
  );
}

/** The big d/h/m/s timer of a full-size band. */
export function Segments({ ms }: { ms: number }) {
  const { days, hours, minutes, seconds } = splitRemaining(ms);
  return (
    <div className="flex shrink-0 items-start gap-4 sm:gap-6">
      <Segment value={days} label="Days" />
      <Segment value={hours} label="Hours" />
      <Segment value={minutes} label="Minutes" />
      <Segment value={seconds} label="Seconds" />
    </div>
  );
}

/** The one-line timer of a docked band. */
function InlineTimer({ ms }: { ms: number }) {
  const { days, hours, minutes, seconds } = splitRemaining(ms);
  return (
    <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
      {days}d {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
    </span>
  );
}

function CountdownBand({ period, now, compact }: { period: OpenPeriod; now: number; compact: boolean }) {
  const left = remaining(period.ends_at, now);
  return (
    <Band bg="hsl(var(--foreground))" fg="hsl(var(--background))" compact={compact}>
      {compact ? (
        <>
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="truncate font-semibold">Applications close in</span>
            <span className="hidden truncate text-xs opacity-70 sm:inline">{period.name}</span>
          </p>
          <InlineTimer ms={left} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-center sm:text-left">
            <Eyebrow>{period.name}</Eyebrow>
            <span className="text-base font-semibold sm:text-lg">Applications close in</span>
          </div>
          <Segments ms={left} />
        </>
      )}
    </Band>
  );
}

function Stack({ ctx, compact }: { ctx: BannerState; compact: boolean }) {
  return (
    <>
      {ctx.announcements.map((a) => (
        <AnnouncementBand key={a.id} a={a} now={ctx.now} compact={compact} />
      ))}
      {ctx.period && <CountdownBand period={ctx.period} now={ctx.now} compact={compact} />}
    </>
  );
}

// The header is h-16; the bands count as scrolled away once they're mostly under it.
const HEADER_PX = 64;

/** Full-size bands in the page flow, right under the header. */
export function HeaderBanners() {
  const ctx = useContext(BannerContext);
  const ref = useRef<HTMLDivElement>(null);
  const has = !!ctx && (ctx.announcements.length > 0 || !!ctx.period);
  const setDocked = ctx?.setDocked;

  useEffect(() => {
    const el = ref.current;
    if (!el || !setDocked) return;
    const io = new IntersectionObserver(
      ([e]) => {
        // Docked once less than ~40% still shows below the header, and only
        // when that's because we scrolled past it (not because it's below the fold).
        setDocked(e.intersectionRatio < 0.4 && e.boundingClientRect.top < HEADER_PX);
      },
      { rootMargin: `-${HEADER_PX}px 0px 0px 0px`, threshold: [0, 0.4, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      setDocked(false);
    };
  }, [has, setDocked]);

  if (!ctx || !has) return null;
  return (
    <div ref={ref} className="flex flex-col animate-fade-in-up">
      <Stack ctx={ctx} compact={false} />
    </div>
  );
}

/**
 * The slim copy, rendered inside the navbar's sticky wrapper. Hangs below the
 * header (absolute, so it never pushes content) and slides out from under it.
 */
export function DockedHeaderBanners() {
  const ctx = useContext(BannerContext);
  if (!ctx || (ctx.announcements.length === 0 && !ctx.period)) return null;
  return (
    <div
      aria-hidden={!ctx.docked}
      inert={!ctx.docked}
      className={cn(
        "absolute inset-x-0 top-full -z-10 flex flex-col shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] transition-[transform,opacity] duration-3 ease-out-quart motion-reduce:transition-none",
        ctx.docked ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
      )}
    >
      <Stack ctx={ctx} compact />
    </div>
  );
}
