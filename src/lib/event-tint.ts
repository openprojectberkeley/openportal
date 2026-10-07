// The one tint rule for an event's surface, shared by the event card, the month
// chip and the week block so the same event reads the same colour everywhere.

import { CATEGORY_META, type EventCategory } from "@/lib/event-category";
import { accentTint } from "@/lib/portal-color";

/**
 * The colour that identifies an event.
 *
 * A categorized event is tinted by its category, so GMs, socials and board
 * meetings read apart at a glance even when they share one portal. "general"
 * events keep the portal tint — that's the pre-category behavior, and every
 * hand-created event defaults to it.
 */
export function eventTintColor(category: EventCategory, portalColor: string | null): string | null {
  return category !== "general" ? CATEGORY_META[category].color : portalColor;
}

/**
 * Opaque surface colour for an event card / chip / week block.
 *
 * Text over this stays `currentColor` (the theme foreground) — NOT
 * readableTextColor(). accentTint mixes toward hsl(var(--background)), so the
 * result is a pale surface in light mode and a dark one in dark mode; the
 * black/white crossover readableTextColor computes is for the RAW accent (the
 * portal-card hover swipe), and using it here produces invisible text in one
 * theme.
 *
 * `pct`: 18 for cards, 24 for month chips, 26 for week blocks — a smaller mark
 * needs more saturation to read as the same colour.
 *
 * This stays a FLAT colour: the event card splices the value into a
 * `linear-gradient(...)` of its own for the hover wash, so a gradient here
 * would nest. The sheen every event surface wears on top is accentSheen(),
 * which is colour-agnostic and layers over this as a backgroundImage.
 */
export function eventSurface(category: EventCategory, portalColor: string | null, pct = 18): string {
  const tint = eventTintColor(category, portalColor);
  return tint
    ? accentTint(tint, pct)!
    : "color-mix(in srgb, hsl(var(--accent)) 40%, hsl(var(--background)))";
}
