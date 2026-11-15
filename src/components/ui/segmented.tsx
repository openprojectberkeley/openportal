"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSlidingIndicator } from "@/lib/use-sliding-indicator";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Accessible name when the label is an icon or abbreviation. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Colour of the sliding pill while this option is selected (e.g. a status). */
  indicatorClassName?: string;
  /** Text colour while selected; defaults to text-background. */
  selectedTextClassName?: string;
};

/**
 * One-of-N choice with a pill that slides to the selection (180ms
 * ease-out-cubic, like the header underline). For a handful of short options
 * (views, durations, statuses); use a Combobox past ~5.
 *
 * Keyboard: it's a radiogroup; arrows move and select, Home/End jump.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  shape = "rounded",
  className,
  itemClassName,
  allowDeselect = false,
  selectOnFocus = true,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "xs" | "sm" | "md";
  /** "pill" fully round (floating docks), "rounded" in-page, "soft" a little squarer (dense grids). */
  shape?: "rounded" | "pill" | "soft";
  className?: string;
  itemClassName?: string;
  /** Clicking the selected option clears it: onChange("") (no selection). */
  allowDeselect?: boolean;
  /**
   * Arrow keys select as they move (default). Off for grids where selecting
   * writes data: arrows only move focus, Space/Enter selects.
   */
  selectOnFocus?: boolean;
  "aria-label"?: string;
}) {
  // Optimistic: the pill moves on click even when the parent's value only
  // updates after async work (e.g. a route push); cleared once it catches up.
  const [pending, setPending] = React.useState<T | null>(null);
  React.useEffect(() => setPending(null), [value]);
  const shown = pending ?? value;
  const select = (v: T) => {
    if (v === shown) {
      if (!allowDeselect) return;
      setPending("" as T);
      onChange("" as T);
      return;
    }
    setPending(v);
    onChange(v);
  };
  const index = options.findIndex((o) => o.value === shown);
  const radius = shape === "pill" ? 9999 : shape === "soft" ? 3 : size === "xs" ? 4 : 6;
  const selectedOption = index >= 0 ? options[index] : null;
  const { rowRef, indicatorRef, itemRef } = useSlidingIndicator(index >= 0 ? index : null, "pill", radius);

  const move = (from: number, delta: number) => {
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + delta * step + n * n) % n;
      if (!options[i].disabled) {
        if (selectOnFocus) select(options[i].value);
        (rowRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[i])?.focus();
        return;
      }
    }
  };

  return (
    <div
      ref={rowRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center gap-0.5 border p-0.5",
        shape === "pill" ? "rounded-full" : shape === "soft" ? "rounded-md" : "rounded-lg",
        className,
      )}
    >
      <span
        ref={indicatorRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-[clip-path,background-color] duration-2 ease-out-cubic motion-reduce:transition-none",
          selectedOption?.indicatorClassName ?? "bg-foreground",
        )}
      />
      {options.map((o, i) => {
        const selected = i === index;
        return (
          <button
            key={o.value}
            ref={itemRef(i)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            tabIndex={selected || (index < 0 && i === 0) ? 0 : -1}
            onClick={() => select(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
              else if (e.key === "Home") { e.preventDefault(); move(-1, 1); }
              else if (e.key === "End") { e.preventDefault(); move(options.length, -1); }
            }}
            className={cn(
              "relative z-10 font-medium transition-colors duration-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40",
              shape === "pill" ? "rounded-full" : shape === "soft" ? "rounded-sm" : size === "xs" ? "rounded" : "rounded-md",
              size === "xs" ? "px-2 py-0.5 text-xs" : size === "sm" ? "px-3 py-1 text-xs" : "px-3 py-1.5 text-sm",
              selected ? (o.selectedTextClassName ?? "text-background") : "text-muted-foreground hover:text-foreground",
              itemClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
