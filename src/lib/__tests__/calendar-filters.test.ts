import { describe, expect, it } from "vitest";
import {
  CLUB_PORTAL_KEY,
  comparePortalOptions,
  matchesFilters,
  portalKeyOf,
  toggleFilterKey,
  type PortalFilterOption,
} from "@/lib/calendar-filters";
import type { EventCategory } from "@/lib/event-category";

const ev = (portal_id: string | null, category: EventCategory = "general") => ({ portal_id, category });
const opt = (key: string, name: string): PortalFilterOption => ({ key, name, color: null });

const NO_CAT = new Set<EventCategory>();
const NO_PORTAL = new Set<string>();

describe("portalKeyOf", () => {
  it("keys a portal event by its portal id", () => {
    expect(portalKeyOf(ev("abc"))).toBe("abc");
  });

  it("keys a club-wide event by the club bucket", () => {
    expect(portalKeyOf(ev(null))).toBe(CLUB_PORTAL_KEY);
  });
});

describe("matchesFilters", () => {
  it("passes everything through when both sets are empty", () => {
    // An empty set is "no filter on this dimension" — the default state.
    expect(matchesFilters(ev("a", "gm"), NO_CAT, NO_PORTAL)).toBe(true);
    expect(matchesFilters(ev(null, "social"), NO_CAT, NO_PORTAL)).toBe(true);
  });

  it("filters by one category", () => {
    const gm = new Set<EventCategory>(["gm"]);
    expect(matchesFilters(ev("a", "gm"), gm, NO_PORTAL)).toBe(true);
    expect(matchesFilters(ev("a", "social"), gm, NO_PORTAL)).toBe(false);
  });

  it("keeps several selected categories", () => {
    const two = new Set<EventCategory>(["gm", "social"]);
    expect(matchesFilters(ev("a", "gm"), two, NO_PORTAL)).toBe(true);
    expect(matchesFilters(ev("a", "social"), two, NO_PORTAL)).toBe(true);
    expect(matchesFilters(ev("a", "board"), two, NO_PORTAL)).toBe(false);
  });

  it("filters by portal alone", () => {
    const only = new Set(["a"]);
    expect(matchesFilters(ev("a"), NO_CAT, only)).toBe(true);
    expect(matchesFilters(ev("b"), NO_CAT, only)).toBe(false);
    expect(matchesFilters(ev(null), NO_CAT, only)).toBe(false);
  });

  it("treats the club as a selectable portal", () => {
    const clubOnly = new Set([CLUB_PORTAL_KEY]);
    expect(matchesFilters(ev(null), NO_CAT, clubOnly)).toBe(true);
    expect(matchesFilters(ev("a"), NO_CAT, clubOnly)).toBe(false);
  });

  it("keeps several selected portals", () => {
    const two = new Set(["a", "b"]);
    expect(matchesFilters(ev("a"), NO_CAT, two)).toBe(true);
    expect(matchesFilters(ev("b"), NO_CAT, two)).toBe(true);
    expect(matchesFilters(ev("c"), NO_CAT, two)).toBe(false);
  });

  it("ANDs the two dimensions", () => {
    const gm = new Set<EventCategory>(["gm"]);
    const only = new Set(["a"]);
    // Right portal, wrong category.
    expect(matchesFilters(ev("a", "social"), gm, only)).toBe(false);
    // Right category, wrong portal.
    expect(matchesFilters(ev("b", "gm"), gm, only)).toBe(false);
    // Both right.
    expect(matchesFilters(ev("a", "gm"), gm, only)).toBe(true);
  });

  it("ANDs multi-selections on both dimensions", () => {
    const cats = new Set<EventCategory>(["gm", "social"]);
    const portals = new Set(["a", CLUB_PORTAL_KEY]);
    expect(matchesFilters(ev(null, "gm"), cats, portals)).toBe(true);
    expect(matchesFilters(ev("a", "social"), cats, portals)).toBe(true);
    expect(matchesFilters(ev("b", "gm"), cats, portals)).toBe(false);
    expect(matchesFilters(ev("a", "board"), cats, portals)).toBe(false);
  });
});

describe("comparePortalOptions", () => {
  it("sorts the club first, then portals A-Z", () => {
    const sorted = [
      opt("z", "Zebra"),
      opt("m", "Mango"),
      opt(CLUB_PORTAL_KEY, "Open Project"),
      opt("a", "Apple"),
    ].sort(comparePortalOptions);
    expect(sorted.map((o) => o.name)).toEqual(["Open Project", "Apple", "Mango", "Zebra"]);
  });

  it("keeps the club first regardless of its label's position in the alphabet", () => {
    // "Open Project" would sort between Mango and Zebra on name alone.
    const sorted = [opt("m", "Mango"), opt(CLUB_PORTAL_KEY, "Open Project")].sort(comparePortalOptions);
    expect(sorted[0].key).toBe(CLUB_PORTAL_KEY);
    const flipped = [opt(CLUB_PORTAL_KEY, "Open Project"), opt("m", "Mango")].sort(comparePortalOptions);
    expect(flipped[0].key).toBe(CLUB_PORTAL_KEY);
  });

  it("is a no-op when comparing the club with itself", () => {
    expect(comparePortalOptions(opt(CLUB_PORTAL_KEY, "x"), opt(CLUB_PORTAL_KEY, "x"))).toBe(0);
  });
});

describe("toggleFilterKey", () => {
  it("adds a key that isn't selected", () => {
    expect([...toggleFilterKey(NO_PORTAL, "a")]).toEqual(["a"]);
  });

  it("removes a key that is selected", () => {
    expect([...toggleFilterKey(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("returns a new set rather than mutating", () => {
    const before = new Set(["a"]);
    const after = toggleFilterKey(before, "b");
    expect(after).not.toBe(before);
    expect([...before]).toEqual(["a"]);
  });

  it("works for category keys too, not just portal ids", () => {
    const cats = toggleFilterKey(new Set<EventCategory>(["gm"]), "social");
    expect([...cats].sort()).toEqual(["gm", "social"]);
  });
});
