// Pure helpers behind the family scoreboard. The SQL aggregation is covered by
// scoring.db.test.ts; this file is the bar-geometry and formatting logic that
// decides what a reader actually sees.

import { describe, it, expect } from "vitest";
import {
  barPct,
  countLabel,
  formatPoints,
  groupByFamily,
  ledgerMatches,
  rankLabel,
  rankProjects,
  type FamilyStanding,
  type LedgerEntry,
  type ProjectScore,
} from "@/lib/scoring";

describe("barPct", () => {
  it("gives the leader the full track", () => {
    expect(barPct(120, 120)).toBe(100);
  });

  it("scales proportionally against the leader", () => {
    expect(barPct(60, 120)).toBe(50);
    expect(barPct(30, 120)).toBe(25);
  });

  it("floors a small but non-zero total at a visible sliver", () => {
    // 3/1000 rounds to 0%, which would render as an invisible hairline.
    expect(barPct(3, 1000)).toBe(2);
  });

  it("draws no bar at or below zero", () => {
    expect(barPct(0, 100)).toBe(0);
    expect(barPct(-25, 100)).toBe(0);
  });

  it("draws no bar when nobody has scored", () => {
    expect(barPct(0, 0)).toBe(0);
    expect(barPct(10, 0)).toBe(0);
  });

  it("clamps a total above the leader rather than overflowing the track", () => {
    expect(barPct(150, 100)).toBe(100);
  });

  it("is 0 for non-finite input rather than producing NaN width", () => {
    expect(barPct(Number.NaN, 100)).toBe(0);
    expect(barPct(50, Number.NaN)).toBe(0);
    expect(barPct(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});

describe("formatPoints", () => {
  it("signs an award and a deduction", () => {
    expect(formatPoints(25)).toBe("+25");
    // A real minus sign, not a hyphen, so the column stays aligned.
    expect(formatPoints(-10)).toBe("−10");
  });

  it("renders zero unsigned", () => {
    expect(formatPoints(0)).toBe("0");
  });
});

describe("countLabel", () => {
  it("pluralizes on anything but one", () => {
    expect(countLabel(1, "project")).toBe("1 project");
    expect(countLabel(0, "project")).toBe("0 projects");
    expect(countLabel(4, "award")).toBe("4 awards");
  });
});

describe("groupByFamily", () => {
  const row = (id: string, familyId: string | null, points: number): ProjectScore => ({
    family_id: familyId,
    project_id: id,
    project_name: id,
    icon: null,
    icon_url: null,
    color: null,
    points,
    award_count: 1,
  });

  it("buckets projects under their family", () => {
    const grouped = groupByFamily([row("a", "f1", 10), row("b", "f2", 5), row("c", "f1", 3)]);
    expect(grouped.get("f1")?.map((p) => p.project_id)).toEqual(["a", "c"]);
    expect(grouped.get("f2")?.map((p) => p.project_id)).toEqual(["b"]);
  });

  it("keeps unassigned projects under the null key", () => {
    const grouped = groupByFamily([row("a", "f1", 10), row("orphan", null, 50)]);
    expect(grouped.get(null)?.map((p) => p.project_id)).toEqual(["orphan"]);
  });

  it("preserves the order the RPC returned", () => {
    const grouped = groupByFamily([row("high", "f1", 50), row("low", "f1", 1)]);
    expect(grouped.get("f1")?.map((p) => p.points)).toEqual([50, 1]);
  });

  it("returns an empty map for no rows", () => {
    expect(groupByFamily([]).size).toBe(0);
  });
});

describe("rankLabel", () => {
  const standing = (rank: number): FamilyStanding => ({
    family_id: `f${rank}-${Math.random()}`,
    family_name: "x",
    icon: null,
    icon_url: null,
    color: null,
    points: 0,
    project_count: 0,
    award_count: 0,
    rank,
  });

  it("marks a shared position", () => {
    // SQL rank() shares a position and then skips: 1, 2, 2, 4.
    const rows = [standing(1), standing(2), standing(2), standing(4)];
    expect(rankLabel(rows, 0)).toBe("1");
    expect(rankLabel(rows, 1)).toBe("T2");
    expect(rankLabel(rows, 2)).toBe("T2");
    expect(rankLabel(rows, 3)).toBe("4");
  });

  it("leaves a unique position bare", () => {
    const rows = [standing(1), standing(2)];
    expect(rankLabel(rows, 0)).toBe("1");
    expect(rankLabel(rows, 1)).toBe("2");
  });

  it("handles a tie at the top", () => {
    const rows = [standing(1), standing(1), standing(3)];
    expect(rankLabel(rows, 0)).toBe("T1");
    expect(rankLabel(rows, 1)).toBe("T1");
    expect(rankLabel(rows, 2)).toBe("3");
  });

  it("handles a single family", () => {
    expect(rankLabel([standing(1)], 0)).toBe("1");
  });
});

describe("rankProjects", () => {
  const row = (name: string, points: number): ProjectScore => ({
    family_id: "f1",
    project_id: name,
    project_name: name,
    icon: null,
    icon_url: null,
    color: null,
    points,
    award_count: 1,
  });

  it("numbers a clear run from one", () => {
    const ranked = rankProjects([row("a", 50), row("b", 30), row("c", 10)]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("shares a tied position and skips past it", () => {
    // Same contract as SQL rank(), which FamilyStanding.rank comes from.
    const ranked = rankProjects([row("a", 50), row("b", 30), row("c", 30), row("d", 10)]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 2, 4]);
  });

  it("sorts input it wasn't given in order", () => {
    const ranked = rankProjects([row("low", 5), row("high", 90), row("mid", 40)]);
    expect(ranked.map((p) => p.project_name)).toEqual(["high", "mid", "low"]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a tie alphabetically", () => {
    const ranked = rankProjects([row("zulu", 20), row("alpha", 20)]);
    expect(ranked.map((p) => p.project_name)).toEqual(["alpha", "zulu"]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 1]);
  });

  it("ranks negatives below zero", () => {
    const ranked = rankProjects([row("a", -5), row("b", 0), row("c", 10)]);
    expect(ranked.map((p) => p.project_name)).toEqual(["c", "b", "a"]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("returns nothing for no rows", () => {
    expect(rankProjects([])).toEqual([]);
  });

  it("leaves the caller's array alone", () => {
    const rows = [row("low", 5), row("high", 90)];
    rankProjects(rows);
    expect(rows.map((p) => p.project_name)).toEqual(["low", "high"]);
  });
});

describe("ledgerMatches", () => {
  const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
    id: "e1",
    project_id: "p1",
    project_name: "Mars Rover",
    family_id: "f1",
    family_name: "Red Family",
    family_color: null,
    points: 25,
    reason: "Won the design review",
    awarded_on: "2026-10-06",
    awarded_by: "u1",
    awarded_by_name: "Dana Patel",
    created_at: "2026-10-06T00:00:00Z",
    voided_at: null,
    ...over,
  });

  it("matches the project, family, reason and awarder", () => {
    expect(ledgerMatches(entry(), "rover")).toBe(true);
    expect(ledgerMatches(entry(), "red")).toBe(true);
    expect(ledgerMatches(entry(), "design")).toBe(true);
    expect(ledgerMatches(entry(), "patel")).toBe(true);
  });

  it("ignores case on both sides", () => {
    expect(ledgerMatches(entry(), "MARS")).toBe(true);
    expect(ledgerMatches(entry({ project_name: "MARS ROVER" }), "mars")).toBe(true);
  });

  it("says no when nothing contains the query", () => {
    expect(ledgerMatches(entry(), "helicopter")).toBe(false);
  });

  it("matches everything on an empty or blank query", () => {
    // An empty box isn't a filter — the caller shouldn't have to special-case it.
    expect(ledgerMatches(entry(), "")).toBe(true);
    expect(ledgerMatches(entry(), "   ")).toBe(true);
  });

  it("trims the query before comparing", () => {
    expect(ledgerMatches(entry(), "  rover  ")).toBe(true);
  });

  it("survives a null family and a null awarder", () => {
    const orphan = entry({ family_id: null, family_name: null, awarded_by_name: null });
    expect(ledgerMatches(orphan, "red")).toBe(false);
    expect(ledgerMatches(orphan, "rover")).toBe(true);
  });

  it("doesn't match on the amount or the raw date", () => {
    // Searching "25" shouldn't surface every row whose reason has a 25 in it,
    // and "2026-10-06" is never on screen in that form.
    expect(ledgerMatches(entry({ reason: "clean" }), "25")).toBe(false);
    expect(ledgerMatches(entry({ reason: "clean" }), "2026-10")).toBe(false);
  });
});
