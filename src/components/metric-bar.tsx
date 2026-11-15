import type React from "react";
import { cn } from "@/lib/utils";
import { visibleMarkColor } from "@/lib/portal-color";

/**
 * One analytics line: label · a thin bar scaled to the section's max · value in
 * Geist Mono. The same shape as the scoreboard's StandingLine (clip-path fill
 * that draws in with `animate-bar-in`), so every list of counts in the app
 * reads as one chart. The fill is neutral foreground; pass `tone` only when the
 * bar means a status, and `mark` (a project dot) for identity.
 */
export function MetricBar({
  label,
  meta,
  mark,
  value,
  max,
  display,
  index = 0,
  tone,
  notch,
  labelClassName,
  valueClassName,
}: {
  label: React.ReactNode;
  /** Muted text after the label (a type, a share). */
  meta?: React.ReactNode;
  mark?: React.ReactNode;
  value: number;
  max: number;
  /** What to print on the right; defaults to `value`. */
  display?: React.ReactNode;
  /** Position in the list, for the draw-in stagger. */
  index?: number;
  tone?: "warning" | "success";
  /** 0–1 position of a capacity tick on the track. */
  notch?: number | null;
  labelClassName?: string;
  /** e.g. `text-warning` on the number alone, keeping the bar neutral. */
  valueClassName?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={cn("flex min-w-0 w-32 shrink-0 items-center gap-2 sm:w-48", labelClassName)}>
        {mark}
        <span className="min-w-0 truncate">{label}</span>
        {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      </span>
      <span className="relative block h-1.5 min-w-0 flex-1 rounded-full bg-foreground/[0.07]">
        <span
          className={cn(
            "block h-full w-full rounded-full animate-bar-in transition-[clip-path] duration-700 ease-out-expo",
            tone === "warning" ? "bg-warning" : tone === "success" ? "bg-success" : "bg-foreground/70",
          )}
          style={{
            clipPath: `inset(0 ${100 - pct}% 0 0 round 9999px)`,
            animationDelay: `${Math.min(index, 12) * 30}ms`,
          }}
        />
        {notch != null && (
          <span
            aria-hidden
            className="absolute -inset-y-1 w-px -translate-x-1/2 bg-foreground"
            style={{ left: `${Math.max(0, Math.min(1, notch)) * 100}%` }}
          />
        )}
      </span>
      <span
        className={cn(
          "w-24 shrink-0 text-right font-mono text-xs font-semibold tabular-nums",
          tone === "warning" && "text-warning",
          valueClassName,
        )}
      >
        {display ?? value}
      </span>
    </div>
  );
}

/** A project's identity mark beside its name. */
export function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full bg-foreground/30"
      style={color ? { backgroundColor: visibleMarkColor(color) } : undefined}
    />
  );
}
