// Unit tests for src/lib/event-category.ts.
//
// The fixtures are the ACTUAL titles from the club's Google Calendar
// ([FA26] Open Project FA26), so a rule change that would misfile a real event
// fails here rather than in production.

import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_BY_DEFAULT,
  CATEGORY_META,
  EVENT_CATEGORIES,
  categorize,
  isEventCategory,
  isRoleGated,
  type EventCategory,
} from "@/lib/event-category";

// Every title in the live calendar, with the bucket it must land in.
const REAL_EVENTS: [title: string, expected: EventCategory][] = [
  ["OP - GM #1", "gm"],
  ["OP - GM #2", "gm"],
  ["OP - GM #3", "gm"],
  ["OP - GM #4", "gm"],
  ["OP - GM #5", "gm"],
  ["OP - GM #6", "gm"],
  ["OP - GM #7", "gm"],
  ["OP - GM #8", "gm"],
  ["OP - GM #9", "gm"],
  ["OP - GM #10", "gm"],
  ["Infosession 1", "recruitment"],
  ["Infosession 2", "recruitment"],
  ["Welcome Night", "recruitment"],
  ["OP - Mid Sem Presentation", "milestone"],
  ["OP - Final Semester Presentations", "milestone"],
  ["OP Retreat", "social"],
  ["OP FA26 Board Photoshoot", "social"],
  ["[OP] First Board Meeting!", "board"],
  ["Databytes", "general"],
];

describe("categorize", () => {
  it.each(REAL_EVENTS)("classifies %j as %s", (title, expected) => {
    expect(categorize(title)).toBe(expected);
  });

  it("covers the whole live calendar", () => {
    expect(REAL_EVENTS).toHaveLength(19);
  });

  // The single most consequential rule: a photoshoot filed as 'board' becomes
  // invisible to every non-board member, and nobody would notice until the
  // shoot was empty.
  it("does not let 'Board Photoshoot' become a board-only event", () => {
    expect(categorize("OP FA26 Board Photoshoot")).toBe("social");
    expect(isRoleGated(categorize("OP FA26 Board Photoshoot"))).toBe(false);
    expect(categorize("Board Photoshoot")).toBe("social");
    expect(categorize("board  photoshoot")).toBe("social");
  });

  it("still catches real board meetings", () => {
    expect(categorize("[OP] First Board Meeting!")).toBe("board");
    expect(categorize("Board Sync")).toBe("board");
    expect(categorize("Exec + Board Retreat")).toBe("board");
  });

  it("falls back to general rather than guessing", () => {
    expect(categorize("Databytes")).toBe("general");
    expect(categorize("")).toBe("general");
    expect(categorize("Coffee")).toBe("general");
  });

  it("reads the description when the title carries no signal", () => {
    // GM #2's real description.
    expect(categorize("OP Event", "Professional Development - Resume Workshop!")).toBe("general");
    expect(categorize("Weekly Sync", "This is our general meeting")).toBe("gm");
  });

  it("never promotes to board from the description alone", () => {
    // An incidental mention in the body must not make an event board-only.
    expect(categorize("Team Hangout", "The board will be there too")).toBe("general");
  });

  it("matches GM numbering variants", () => {
    expect(categorize("GM 3")).toBe("gm");
    expect(categorize("GM#12")).toBe("gm");
    expect(categorize("gm # 4")).toBe("gm");
    // "GM" with no number is too ambiguous to claim.
    expect(categorize("GMail setup")).toBe("general");
  });
});

describe("category metadata", () => {
  it("defines a label, color and attendance default for every category", () => {
    for (const category of EVENT_CATEGORIES) {
      expect(CATEGORY_META[category]?.label).toBeTruthy();
      expect(CATEGORY_META[category]?.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof ATTENDANCE_BY_DEFAULT[category]).toBe("boolean");
    }
  });

  it("enables attendance for exactly GM, milestone and board", () => {
    const on = EVENT_CATEGORIES.filter((c) => ATTENDANCE_BY_DEFAULT[c]);
    expect(on).toEqual(["gm", "milestone", "board"]);
  });

  it("role-gates only board", () => {
    expect(EVENT_CATEGORIES.filter(isRoleGated)).toEqual(["board"]);
  });

  it("guards category values coming off the wire", () => {
    expect(isEventCategory("gm")).toBe(true);
    expect(isEventCategory("nope")).toBe(false);
    expect(isEventCategory(null)).toBe(false);
  });
});
