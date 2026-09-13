// Unit tests for src/lib/portal-color.ts.
//
// The calendar's portal backing card paints a portal's raw accent at full
// strength and lays its name directly on top, so hoverForeground() is the only
// thing keeping that name legible. Same for the portal cards' hover swipe.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  accentTint,
  hoverForeground,
  readableTextColor,
} from "@/lib/portal-color";

const BLACK = "#000000";
const WHITE = "#ffffff";

describe("readableTextColor", () => {
  it("picks dark text on light accents", () => {
    expect(readableTextColor("#ffffff")).toBe(BLACK);
    expect(readableTextColor("#f59e0b")).toBe(BLACK); // amber
    expect(readableTextColor("#22c55e")).toBe(BLACK); // green
  });

  it("picks light text on dark accents", () => {
    expect(readableTextColor("#000000")).toBe(WHITE);
    expect(readableTextColor("#1e3a8a")).toBe(WHITE); // navy
    expect(readableTextColor("#7c3aed")).toBe(WHITE); // violet-600
    expect(readableTextColor("#b91c1c")).toBe(WHITE); // red-700
  });

  // Worth pinning: a mid-tone indigo looks "dark" but lands just above the
  // 0.179 crossover (relative luminance ~0.185), where black actually wins on
  // contrast — 4.70 against black vs 4.47 against white. Not a bug.
  it("prefers dark text for mid-tone accents that sit just above the crossover", () => {
    expect(readableTextColor("#6366f1")).toBe(BLACK); // indigo-500
  });

  it("expands 3-digit hex", () => {
    expect(readableTextColor("#fff")).toBe(readableTextColor("#ffffff"));
    expect(readableTextColor("#000")).toBe(readableTextColor("#000000"));
  });

  it("falls back to white rather than throwing on bad input", () => {
    expect(readableTextColor(null)).toBe(WHITE);
    expect(readableTextColor("")).toBe(WHITE);
    expect(readableTextColor("not-a-color")).toBe(WHITE);
    expect(readableTextColor("#12345")).toBe(WHITE);
  });
});

describe("hoverForeground", () => {
  // A portal with no color set paints DEFAULT_ACCENT, a light gray — so the
  // label must come out dark. Getting this backwards gives white-on-light-gray.
  it("returns dark text for a colorless portal's default accent", () => {
    expect(hoverForeground(null)).toBe(BLACK);
    expect(hoverForeground("")).toBe(BLACK);
    expect(readableTextColor(DEFAULT_ACCENT)).toBe(BLACK);
  });

  it("otherwise matches readableTextColor for the given accent", () => {
    for (const c of ["#6366f1", "#f59e0b", "#22c55e", "#ef4444", "#0a0a0a"]) {
      expect(hoverForeground(c)).toBe(readableTextColor(c));
    }
  });
});

describe("accentTint", () => {
  it("mixes toward the theme background so it works in both themes", () => {
    expect(accentTint("#6366f1", 18)).toBe(
      "color-mix(in srgb, #6366f1 18%, hsl(var(--background)))",
    );
  });

  it("returns undefined with no color, so callers can fall back", () => {
    expect(accentTint(null)).toBeUndefined();
    expect(accentTint(undefined)).toBeUndefined();
    expect(accentTint("")).toBeUndefined();
  });
});
