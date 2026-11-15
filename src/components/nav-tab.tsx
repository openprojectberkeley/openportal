"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type Ref,
} from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavTabSpec = {
  href: string;
  icon: LucideIcon;
  label: string;
  /**
   * How the current route marks this tab active. Defaults to "exact" for "/"
   * and "prefix" for everything else — "/" prefix-matches every route, so a
   * prefix default would light Dashboard up permanently.
   */
  match?: "exact" | "prefix";
};

/**
 * The active marker's two shapes, as clip-paths over the full tab cell. A CSS
 * transition between them is the whole selection animation: the shape lifts
 * off the header's bottom edge as a 2px underline and morphs into a slightly
 * rounded badge around the icon + label (and the old badge sinks back down).
 * Same inset() form on both ends, so the browser interpolates every edge and
 * the corner radius together.
 */
const BAR_SHAPE = "inset(calc(100% - 2px) 0px 0px 0px round 0px)";
// h-16 cell − 2×14px = a 36px (h-9) badge; 6px in from the cell's px-4 edges
// leaves 10px of badge padding around the content.
const BADGE_SHAPE = "inset(14px 6px 14px 6px round 6px)";

/** Icon + label. Rendered twice per tab: once plain, once inverted. */
function TabContent({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <>
      <Icon size={16} className="shrink-0" aria-hidden />
      {/* Dropped below sm so three labelled tabs still fit at 375px. */}
      <span className="hidden sm:inline">{label}</span>
    </>
  );
}

const CONTENT = "inline-flex items-center gap-1.5 whitespace-nowrap px-4";

/**
 * One header tab: a full-height (h-16) cell, so the underline NavTabs glides
 * along the header's bottom rule belongs to it. The active tab wears an
 * inverted, slightly rounded badge. Hover is not drawn here: NavTabs owns the
 * single underline, and selecting morphs that underline into the badge.
 *
 * The badge is an overlay carrying its own inverted copy of the icon + label,
 * clipped to the badge shape — so mid-morph the text inverts exactly where the
 * shape covers it rather than flashing background-on-background. It's always
 * mounted (hidden when inactive) so the shape can transition both ways.
 *
 * Deliberately hook-free so it can render in the prerendered shell — the route
 * match is resolved by NavTabs, which owns the one uncached read.
 */
export function NavTab({
  href,
  icon,
  label,
  active,
  ref,
  onClick,
  onPointerEnter,
  onFocus,
  onBlur,
}: Omit<NavTabSpec, "match"> & {
  active: boolean;
  ref?: Ref<HTMLAnchorElement>;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  onPointerEnter?: (e: PointerEvent<HTMLAnchorElement>) => void;
  onFocus?: (e: FocusEvent<HTMLAnchorElement>) => void;
  onBlur?: () => void;
}) {
  return (
    <Link
      ref={ref}
      href={href}
      // Always set: below sm the label is display:none, which drops it from the
      // accessibility tree and would leave an icon-only link with no name. Same
      // string as the visible text, so WCAG 2.5.3 (label in name) still holds.
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(
        "group relative flex h-16 items-center font-medium",
        // [outline-style:solid], not `outline`: tailwind-merge drops `outline`
        // as conflicting with `outline-2`, leaving the browser's `auto` ring.
        // Inset so the header edges don't clip it; it runs outside the badge.
        "focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring",
      )}
    >
      <span
        className={cn(
          CONTENT,
          "transition-colors duration-2 ease-out-cubic motion-reduce:transition-none",
          active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        <TabContent icon={icon} label={label} />
      </span>
      <span
        aria-hidden
        style={{ clipPath: active ? BADGE_SHAPE : BAR_SHAPE, opacity: active ? 1 : 0 }}
        className={cn(
          CONTENT,
          "pointer-events-none absolute inset-0 bg-foreground text-background",
          // The shape takes its time (300ms, ease-out-cubic — quart would spend
          // most of the move in the first 100ms); the fade is quicker so the
          // bar is solid as it leaves the bottom edge, and gone before a
          // sinking badge reaches it.
          "motion-safe:[transition:clip-path_var(--dur-4)_var(--ease-out-cubic),opacity_var(--dur-1)_var(--ease-out-cubic)]",
        )}
      >
        <TabContent icon={icon} label={label} />
      </span>
    </Link>
  );
}

function isActive(pathname: string, { href, match }: NavTabSpec): boolean {
  const mode = match ?? (href === "/" ? "exact" : "prefix");
  // `${href}/`, not a bare startsWith — else /calendar would also match a
  // future /calendar-archive.
  return mode === "exact"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

// Full header height, flush tabs: the underline track sits on the header's
// bottom rule (app-navbar.tsx).
const ROW = "relative flex h-full items-stretch";

/**
 * The tab row, with the active tab resolved from the current route.
 *
 * usePathname() is uncached request data, so under `cacheComponents` this must
 * render inside a Suspense boundary or it blocks every route's prerender — the
 * navbar sits in the shell of all of them. NavTabsFallback is what the shell
 * gets; it's the same markup minus the active badge, so nothing shifts.
 *
 * Motion:
 * - One 2px underline on the header's bottom edge. Hover / focus-visible glides
 *   it to that tab (translateX + scaleX from measured rects, never width/left).
 *   It parks, invisible, under the active tab: leaving the row glides it home
 *   as it fades, and hovering out from the active tab glides it in from there.
 *   Hidden on touch (hover: none).
 * - Click marks the tab active optimistically, before the route resolves. The
 *   underline under the pointer lifts and morphs into the badge (NavTab).
 */
export function NavTabs({ tabs }: { tabs: NavTabSpec[] }) {
  const pathname = usePathname();
  // Optimistic selection from a tab click. Cleared (during render, so there's
  // no stale frame) the moment the pathname changes, however it changed: a
  // non-header link, Back/Forward, a router.push. Keeping it keyed to the
  // pathname it was made on instead let it come back to life when you later
  // returned to that path some other way, lighting up the wrong tab.
  const [pending, setPending] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setPending(null);
  }
  const pendingHref = pending;
  const activeIndex = pendingHref
    ? tabs.findIndex((t) => t.href === pendingHref)
    : tabs.findIndex((t) => isActive(pathname, t));

  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const pointed = hovered ?? focused;
  const target = pointed ?? (activeIndex >= 0 ? activeIndex : null);
  // The badge already marks the active tab; an underline under it is noise.
  const visible = pointed !== null && pointed !== activeIndex;

  const rowRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const latest = useRef({ target, visible });
  // Whether the bar currently has a meaningful position to glide from.
  const parked = useRef(false);

  // Writes straight to the bar's style: this runs on every hover change and on
  // resize, and the transform is a function of layout, not of React state.
  const place = useCallback((index: number | null, show: boolean, instant: boolean) => {
    const row = rowRef.current;
    const bar = barRef.current;
    if (!row || !bar) return;
    const tab = index === null ? null : tabRefs.current[index];
    if (!tab) {
      bar.style.opacity = "0";
      parked.current = false;
      return;
    }
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (!r.width) return;
    // No position yet (first paint, or no active tab to park under): snap into
    // place rather than gliding in from wherever it last was.
    const jump = instant || !parked.current;
    if (jump) bar.style.transitionProperty = "none";
    bar.style.transform = `translateX(${t.left - r.left}px) scaleX(${t.width / r.width})`;
    if (jump) {
      void bar.offsetWidth; // commit the jump before restoring the transition
      bar.style.transitionProperty = "";
    }
    bar.style.opacity = show ? "1" : "0";
    parked.current = true;
  }, []);

  useLayoutEffect(() => {
    latest.current = { target, visible };
    place(target, visible, false);
  }, [target, visible, place]);

  // Labels appear at sm, fonts swap in late: re-measure, without gliding.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => place(latest.current.target, latest.current.visible, true));
    ro.observe(row);
    for (const tab of tabRefs.current) if (tab) ro.observe(tab);
    return () => ro.disconnect();
  }, [place, tabs.length]);

  return (
    <div ref={rowRef} className={ROW} onPointerLeave={() => setHovered(null)}>
      <span
        ref={barRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left bg-foreground opacity-0",
          "transition-[transform,opacity] duration-2 ease-out-cubic will-change-transform",
          "motion-reduce:transition-none [@media(hover:none)]:hidden",
        )}
      />
      {tabs.map((t, i) => (
        <NavTab
          key={t.href}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          href={t.href}
          icon={t.icon}
          label={t.label}
          active={i === activeIndex}
          onPointerEnter={(e) => {
            if (e.pointerType !== "touch") setHovered(i);
          }}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setFocused(i);
          }}
          onBlur={() => setFocused(null)}
          onClick={(e) => {
            // Let new-tab / new-window clicks through without selecting here.
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
              return;
            }
            if (!isActive(pathname, t)) setPending(t.href);
          }}
        />
      ))}
    </div>
  );
}

export function NavTabsFallback({ tabs }: { tabs: NavTabSpec[] }) {
  return (
    <div className={ROW}>
      {tabs.map((t) => (
        <NavTab key={t.href} href={t.href} icon={t.icon} label={t.label} active={false} />
      ))}
    </div>
  );
}
