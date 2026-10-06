"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A horizontal, wrapping run of chips — the compact alternative to a stacked
 * list of one-line rows. Rosters here are tens of names, and a full-width row
 * each wasted most of the panel's width and pushed everything below the fold.
 */
export function ChipList({
  children,
  empty,
  className,
}: {
  children: React.ReactNode;
  /** Shown instead of the chips when there are none. */
  empty?: React.ReactNode;
  className?: string;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;

  if (isEmpty && empty) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{items}</div>;
}

/**
 * One entry in a ChipList: a pill holding a label plus whatever trailing
 * controls that list needs (an admin crown, a remove button).
 *
 * `onRemove` renders the X itself so every list gets the same hit target and
 * the same hover colour, rather than each one rebuilding it.
 */
export function Chip({
  children,
  onRemove,
  removeLabel,
  className,
  style,
}: {
  children: React.ReactNode;
  onRemove?: () => void;
  /** Accessible name for the remove button, e.g. "Remove Jane from Red". */
  removeLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-foreground/10 py-1 text-xs font-medium text-foreground",
        onRemove ? "pl-2.5 pr-1.5" : "px-2.5",
        className,
      )}
      style={style}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-red-500"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
