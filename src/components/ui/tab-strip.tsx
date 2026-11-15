"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSlidingIndicator } from "@/lib/use-sliding-indicator";

export type TabStripTab<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Muted count after the label, e.g. "Members (42)". */
  count?: number | null;
};

/**
 * In-page tabs: a bottom rule with one 2px underline that slides to the
 * selected tab (180ms ease-out-cubic, same as the header). Proper tablist:
 * roving tabindex, arrows/Home/End move and select. Pass `panelId` to wire
 * aria-controls to the panel each tab shows.
 */
export function TabStrip<T extends string>({
  value,
  onChange,
  tabs,
  className,
  panelId,
  idPrefix = "tab",
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: TabStripTab<T>[];
  className?: string;
  panelId?: (value: T) => string;
  /** Tab element ids are `${idPrefix}-${value}` (for aria-labelledby on panels). */
  idPrefix?: string;
  "aria-label"?: string;
}) {
  const index = tabs.findIndex((t) => t.value === value);
  const { rowRef, indicatorRef, itemRef } = useSlidingIndicator(index >= 0 ? index : null, "bar");

  const select = (i: number) => {
    const n = tabs.length;
    const next = ((i % n) + n) % n;
    onChange(tabs[next].value);
    rowRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  return (
    <div ref={rowRef} role="tablist" aria-label={ariaLabel} className={cn("relative flex gap-1 border-b", className)}>
      <span
        ref={indicatorRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] origin-left bg-foreground opacity-0 transition-transform duration-2 ease-out-cubic will-change-transform motion-reduce:transition-none"
      />
      {tabs.map((t, i) => {
        const selected = i === index;
        return (
          <button
            key={t.value}
            ref={itemRef(i)}
            type="button"
            role="tab"
            id={`${idPrefix}-${t.value}`}
            aria-selected={selected}
            aria-controls={panelId?.(t.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); select(i + 1); }
              else if (e.key === "ArrowLeft") { e.preventDefault(); select(i - 1); }
              else if (e.key === "Home") { e.preventDefault(); select(0); }
              else if (e.key === "End") { e.preventDefault(); select(tabs.length - 1); }
            }}
            className={cn(
              "px-3 py-2 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count != null && <span className="ml-1 text-[10px] font-normal text-muted-foreground/60">({t.count})</span>}
          </button>
        );
      })}
    </div>
  );
}
