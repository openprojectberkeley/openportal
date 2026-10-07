// The calendar's two filter dimensions, as pure functions.
//
// Split out of use-calendar-events so the ordering and the AND can be
// unit-tested without a React harness — same reason event-days.ts and
// week-layout.ts live apart from the components that use them.

import type { EventCategory } from "@/lib/event-category";

/**
 * Filter key for club-wide events, which have no portal id to key on.
 *
 * Deliberately its own constant rather than reusing the event form's
 * CLUB_EVENT_OPTION: that one is a <select> value, and a change to how the form
 * represents "club-wide" shouldn't silently repoint the calendar's filter.
 */
export const CLUB_PORTAL_KEY = "__club__";

/** One entry in the portal filter row. */
export type PortalFilterOption = { key: string; name: string; color: string | null };

/** The minimum of an event these filters read. */
export type FilterableEvent = { portal_id: string | null; category: EventCategory };

/** Which bucket an event is filtered by: its portal, or the club. */
export function portalKeyOf(ev: FilterableEvent): string {
  return ev.portal_id ?? CLUB_PORTAL_KEY;
}

/**
 * Does this event survive both filters?
 *
 * The two are independent dimensions, so they AND. An empty set means "no
 * filter on this dimension", so the default state passes everything through —
 * which is what lets one control serve both "show all" and "show these".
 */
export function matchesFilters(
  ev: FilterableEvent,
  categoryFilter: ReadonlySet<EventCategory>,
  portalFilter: ReadonlySet<string>,
): boolean {
  if (categoryFilter.size > 0 && !categoryFilter.has(ev.category)) return false;
  if (portalFilter.size > 0 && !portalFilter.has(portalKeyOf(ev))) return false;
  return true;
}

/** The club first — it's everyone's schedule — then portals A-Z. */
export function comparePortalOptions(a: PortalFilterOption, b: PortalFilterOption): number {
  if (a.key === CLUB_PORTAL_KEY) return b.key === CLUB_PORTAL_KEY ? 0 : -1;
  if (b.key === CLUB_PORTAL_KEY) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * Toggle one key in a filter set, returning a new set.
 *
 * Generic over the key type so the category and portal filters share it — both
 * are "a set of selected strings", and a new set is what React needs to see a
 * change.
 */
export function toggleFilterKey<T extends string>(current: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
