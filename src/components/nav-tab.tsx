"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * One header tab. The hover is the house accent swipe (portal-card.tsx, and the
 * Application Manager pill on the dashboard): the inverted background eases in
 * from the left behind both the icon and the label, and the content inverts
 * with it. The active tab wears that end state as its resting look.
 *
 * Deliberately hook-free so it can render in the prerendered shell — the route
 * match is resolved by NavTabs, which owns the one uncached read.
 */
export function NavTab({
  href,
  icon: Icon,
  label,
  active,
}: Omit<NavTabSpec, "match"> & { active: boolean }) {
  return (
    <Link
      href={href}
      // Always set: below sm the label is display:none, which drops it from the
      // accessibility tree and would leave an icon-only link with no name. Same
      // string as the visible text, so WCAG 2.5.3 (label in name) still holds.
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative inline-flex h-9 items-center overflow-hidden rounded-full px-3 font-medium",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-foreground text-background" : "text-muted-foreground",
      )}
    >
      {/* Only on an inactive tab: the active tab already has the fill as its
          background, so a scaled-up swipe over it would be dead DOM. On
          navigation `active` flips and this unmounts in the same commit the
          parent gains bg-foreground, so there's no intermediate frame. */}
      {!active && (
        <span
          aria-hidden
          className="absolute inset-0 z-0 origin-left scale-x-0 bg-foreground transition-transform duration-300 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
        />
      )}
      <span
        className={cn(
          "relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
          !active && "group-hover:text-background",
        )}
      >
        <Icon size={16} className="shrink-0" aria-hidden />
        {/* Dropped below sm so three labelled tabs still fit at 375px. */}
        <span className="hidden sm:inline">{label}</span>
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

const ROW = "flex items-center gap-0.5 sm:gap-1";

/**
 * The tab row, with the active tab resolved from the current route.
 *
 * usePathname() is uncached request data, so under `cacheComponents` this must
 * render inside a Suspense boundary or it blocks every route's prerender — the
 * navbar sits in the shell of all of them. NavTabsFallback is what the shell
 * gets; it's the same markup minus the active fill, so nothing shifts.
 */
export function NavTabs({ tabs }: { tabs: NavTabSpec[] }) {
  const pathname = usePathname();
  return (
    <div className={ROW}>
      {tabs.map((t) => (
        <NavTab key={t.href} href={t.href} icon={t.icon} label={t.label} active={isActive(pathname, t)} />
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
