// Pure helpers behind the family scoreboard. The SQL aggregation is covered by
// scoring.db.test.ts; this file is the bar-geometry and formatting logic that
// decides what a reader actually sees.

import { describe, it, expect } from "vitest";
import {
  barPct,
  countLabel,
  formatPoints,
  groupByFamily,
  rankLabel,
  type FamilyStanding,
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
