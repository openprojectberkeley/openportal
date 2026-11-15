// Unit tests for src/lib/portal-color.ts.
//
// The calendar's portal backing card paints a portal's raw accent at full
// strength and lays its name directly on top, so hoverForeground() is the only
// thing keeping that name legible. Same for the portal cards' hover swipe.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  accentRing,
  readableAccentText,
  accentStyle,
  accentFill,
  accentTint,
  hoverForeground,
  readableTextColor,
  visibleMarkColor,
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

describe("accentRing", () => {
  it("is a 1px inset ring of the accent at low alpha, so it costs no layout", () => {
    expect(accentRing("#6366f1")).toBe(
      "inset 0 0 0 1px color-mix(in srgb, #6366f1 14%, transparent)",
    );
  });

  it("returns undefined with no accent", () => {
    expect(accentRing(null)).toBeUndefined();
  });
});

describe("accentFill", () => {
  it("paints the raw accent flat, with text that survives on it", () => {
    expect(accentFill("#6366f1")).toEqual({
      backgroundColor: "#6366f1",
      color: readableTextColor("#6366f1"),
    });
  });

  it("picks dark text on a light accent", () => {
    expect(accentFill("#EAB308")?.color).toBe("#000000");
  });

  it("returns undefined with no accent, so callers fall back to their own class", () => {
    expect(accentFill(null)).toBeUndefined();
  });
});

describe("accentStyle", () => {
  it("tints toward --muted so it matches the plain cards, with no accent border", () => {
    expect(accentStyle("#6366f1")).toEqual({
      // 22%, not accentTint's own 14% default — see the note on accentStyle.
      backgroundColor: accentTint("#6366f1", 22, "hsl(var(--muted))"),
      boxShadow: accentRing("#6366f1"),
    });
  });

  it("passes a caller's pct through to the flat tint beneath", () => {
    expect(accentStyle("#6366f1", 24)).toEqual({
      backgroundColor: accentTint("#6366f1", 24, "hsl(var(--muted))"),
      boxShadow: accentRing("#6366f1"),
    });
  });

  it("returns undefined with no accent", () => {
    expect(accentStyle(null)).toBeUndefined();
  });
});

describe("visibleMarkColor", () => {
  it("leaves an ordinary accent alone", () => {
    expect(visibleMarkColor("#22c55e")).toBe("#22c55e");
  });

  it("pulls a near-black accent toward the foreground so the mark stays visible", () => {
    expect(visibleMarkColor("#1e1b4b")).toBe(
      "color-mix(in srgb, #1e1b4b 65%, hsl(var(--foreground)))",
    );
  });

  it("passes an unparseable colour through", () => {
    expect(visibleMarkColor("rebeccapurple")).toBe("rebeccapurple");
  });
});

describe("readableAccentText", () => {
  it("mixes the accent toward the theme foreground", () => {
    expect(readableAccentText("#f59e0b")).toBe("color-mix(in srgb, #f59e0b 70%, hsl(var(--foreground)))");
  });
});
