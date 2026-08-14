"use client";

import { Crown, Lock } from "lucide-react";

type Props = {
  /** Whether the admin tier is granted (crown "on"). */
  active: boolean;
  /** Owner crowns are gold; every other active crown is white-filled. */
  owner?: boolean;
  /** When provided the crown is an interactive toggle. */
  onToggle?: () => void;
  /** Locked = shown like "on" but dimmed and inert. */
  locked?: boolean;
  /**
   * For read-only crowns sitting inside a `group` that recolors its text to
   * `--hover-fg` on hover (e.g. the portal card): make the crown follow that
   * same color on hover so it stays visible against the accent swipe.
   */
  hoverInheritFg?: boolean;
  size?: number;
};

// Admin tier shown as a crown:
//   off (toggle)      → light-gray outline, turns white outline on hover
//   on (toggle)       → filled crown (gold if owner, else white)
//   locked            → dimmed crown with a small lock badge, no hover, inert
//   read-only display → same as on, not clickable
export function AdminCrown({ active, owner = false, onToggle, locked = false, hoverInheritFg = false, size = 16 }: Props) {
  const fillClass = owner ? "text-amber-400 fill-current" : "text-white fill-current";
  // On hover, follow the group's hover text color so the crown stays visible.
  const hoverClass = hoverInheritFg ? " transition-colors group-hover:text-[var(--hover-fg)]" : "";

  // Non-interactive states only ever render when admin is actually granted.
  if (locked || !onToggle) {
    if (!active) return null;
    return (
      <span
        className="relative inline-flex items-center justify-center p-1"
        aria-label={locked ? "Admin (locked)" : "Admin"}
      >
        {/* Locked crowns are grayed out and carry a small lock badge on their
            bottom-right corner instead of a separate lock icon alongside. */}
        <Crown size={size} className={fillClass + hoverClass + (locked ? " opacity-50" : "")} />
        {locked && (
          <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-background" aria-hidden>
            <Lock size={Math.round(size * 0.5)} strokeWidth={2.5} className="text-muted-foreground" />
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? "Remove admin" : "Grant admin"}
      className="group inline-flex items-center justify-center p-1"
    >
      <Crown
        size={size}
        className={
          active
            ? fillClass
            : "text-muted-foreground/50 fill-transparent transition-colors group-hover:text-white"
        }
      />
    </button>
  );
}
