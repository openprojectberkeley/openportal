// Event categories: the organizing layer over portal_events (migration 0093).
//
// Pure and dependency-free so both the browser (filter chips, card colors) and
// the server (the Google Calendar sync) share one definition, and so the
// title-matching rules can be unit-tested against the real calendar.

export const EVENT_CATEGORIES = [
  "general",
  "gm",
  "recruitment",
  "milestone",
  "social",
  "board",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function isEventCategory(v: unknown): v is EventCategory {
  return typeof v === "string" && (EVENT_CATEGORIES as readonly string[]).includes(v);
}

export const CATEGORY_META: Record<EventCategory, { label: string; color: string }> = {
  general:     { label: "General",     color: "#64748b" }, // slate
  gm:          { label: "GM",          color: "#3b82f6" }, // blue
  recruitment: { label: "Recruitment", color: "#22c55e" }, // green
  milestone:   { label: "Milestone",   color: "#a855f7" }, // purple
  social:      { label: "Social",      color: "#f59e0b" }, // amber
  board:       { label: "Board",       color: "#ef4444" }, // red
};

// Categories whose events opt into attendance by default when synced. Admins
// can still toggle `attendance_enabled` per event afterwards.
export const ATTENDANCE_BY_DEFAULT: Record<EventCategory, boolean> = {
  general: false,
  gm: true,
  recruitment: false,
  milestone: true,
  social: false,
  board: true,
};

// Only 'board' is role-gated (RLS in 0093 + the client mirror in the calendar
// panel). Exported so the UI can warn when tagging an event board-only.
export function isRoleGated(category: EventCategory): boolean {
  return category === "board";
}

// First match wins, so order encodes precedence.
//
// `board` is checked first because "[OP] First Board Meeting!" must beat any
// later rule — but the negative lookahead is load-bearing: "OP FA26 Board
// Photoshoot" is a social, and misfiling it as board would hide the photoshoot
// from every ordinary member.
const RULES: readonly (readonly [RegExp, EventCategory])[] = [
  [/\bboard\b(?!\s+photoshoot\b)/i, "board"],
  [/\bGM\s*#?\s*\d+\b|\bgeneral meeting\b/i, "gm"],
  [/\binfo\s?session\b|\bwelcome night\b|\brecruit/i, "recruitment"],
  [/\bpresentations?\b|\bdemo day\b|\bshowcase\b/i, "milestone"],
  [/\bretreat\b|\bphotoshoot\b|\bsocial\b|\bmixer\b|\bbanquet\b/i, "social"],
];

/**
 * Best-guess category for an event, from its title (and description as a
 * fallback for titles that carry no signal, like "Databytes"). Returns
 * "general" when nothing matches — deliberately, so an unrecognized event stays
 * visible to everyone rather than being guessed into a role-gated bucket.
 */
export function categorize(title: string, description?: string | null): EventCategory {
  for (const [pattern, category] of RULES) {
    if (pattern.test(title)) return category;
  }
  // Titles like "OP - GM #2" carry the kind; some events only say it in the
  // body ("Professional Development - Resume Workshop!"). Never let the body
  // promote an event to 'board' — that would be a visibility decision made on
  // an incidental mention.
  if (description) {
    for (const [pattern, category] of RULES) {
      if (category !== "board" && pattern.test(description)) return category;
    }
  }
  return "general";
}
