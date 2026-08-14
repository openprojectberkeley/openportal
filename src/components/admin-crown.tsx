"use client";

import { Crown } from "lucide-react";

type Props = {
  /** Whether the admin tier is granted (crown "on"). */
  active: boolean;
  /** Owner crowns are gold; every other active crown is white-filled. */
  owner?: boolean;
  /** When provided the crown is an interactive toggle. */
  onToggle?: () => void;
  /** Locked = shown like "on" but dimmed and inert. */
  locked?: boolean;
  size?: number;
};

// Admin tier shown as a crown:
//   off (toggle)      → light-gray outline, turns white outline on hover
//   on (toggle)       → filled crown (gold if owner, else white)
//   locked            → same as on, dimmed, no hover, not clickable
//   read-only display → same as on, not clickable
export function AdminCrown({ active, owner = false, onToggle, locked = false, size = 16 }: Props) {
  const fillClass = owner ? "text-amber-400 fill-current" : "text-white fill-current";

  // Non-interactive states only ever render when admin is actually granted.
  if (locked || !onToggle) {
    if (!active) return null;
    return (
      <span
        className={`inline-flex items-center justify-center p-1 ${locked ? "opacity-50" : ""}`}
        aria-label={locked ? "Admin (locked)" : "Admin"}
      >
        <Crown size={size} className={fillClass} />
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
