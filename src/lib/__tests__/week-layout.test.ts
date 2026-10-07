import { describe, expect, it } from "vitest";
import { isBandEvent, layoutDay } from "@/lib/week-layout";

// TZ is pinned to UTC by vitest.config.ts, so local time is UTC here.

const HOUR_PX = 48;
const MIN_PX = 18;

const DAY = new Date(2026, 9, 6); // Tue Oct 6 2026

function ev(start: string, end: string | null, id = start) {
  return { id, start_time: start, end_time: end };
}

const at = (h: number, m = 0) =>
  `2026-10-06T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

describe("isBandEvent", () => {
  it("puts an all-day event in the band", () => {
    expect(isBandEvent({ ...ev(at(0), at(23)), all_day: true })).toBe(true);
  });

  it("puts a multi-day event in the band, even a timed one", () => {
    // The two-day retreat: end_time is stored INCLUSIVE, so this is 2 days.
    const retreat = { start_time: "2026-09-26T18:00:00Z", end_time: "2026-09-27T22:00:00Z", all_day: false };
    expect(isBandEvent(retreat)).toBe(true);
  });

  it("leaves an ordinary timed event out of the band", () => {
    expect(isBandEvent({ ...ev(at(18), at(20)), all_day: false })).toBe(false);
  });
});

describe("layoutDay geometry", () => {
  it("positions a block from its start and duration", () => {
    const [b] = layoutDay([ev(at(9), at(10, 30))], DAY, HOUR_PX, MIN_PX);
    expect(b.topPx).toBe(9 * HOUR_PX);
    expect(b.heightPx).toBe(1.5 * HOUR_PX);
    expect(b.lane).toBe(0);
    expect(b.lanes).toBe(1);
  });

  it("gives an event with no end_time an hour of height", () => {
    const [b] = layoutDay([ev(at(14), null)], DAY, HOUR_PX, MIN_PX);
    expect(b.heightPx).toBe(HOUR_PX);
  });

  it("floors a very short event at minPx so it stays clickable", () => {
    // A 15-minute coffee chat is 12px at this scale — too small to hit.
    const [b] = layoutDay([ev(at(15), at(15, 15))], DAY, HOUR_PX, MIN_PX);
    expect(b.heightPx).toBe(MIN_PX);
  });

  it("keeps a late event inside the column", () => {
    const [b] = layoutDay([ev(at(23), at(23, 30))], DAY, HOUR_PX, MIN_PX);
    expect(b.topPx).toBe(23 * HOUR_PX);
    expect(b.topPx + b.heightPx).toBeLessThanOrEqual(24 * HOUR_PX);
  });

  it("skips an event with an unparseable start", () => {
    expect(layoutDay([ev("not-a-date", null)], DAY, HOUR_PX, MIN_PX)).toHaveLength(0);
  });
});

describe("layoutDay midnight clamping", () => {
  it("clamps an event that started yesterday to the top of this day", () => {
    const overnight = ev("2026-10-05T22:00:00Z", "2026-10-06T02:00:00Z");
    const [b] = layoutDay([overnight], DAY, HOUR_PX, MIN_PX);
    expect(b.topPx).toBe(0);
    expect(b.heightPx).toBe(2 * HOUR_PX);
  });

  it("clamps an event running into tomorrow to the bottom of this day", () => {
    const overnight = ev("2026-10-06T22:00:00Z", "2026-10-07T02:00:00Z");
    const [b] = layoutDay([overnight], DAY, HOUR_PX, MIN_PX);
    expect(b.topPx).toBe(22 * HOUR_PX);
    expect(b.heightPx).toBe(2 * HOUR_PX);
    expect(b.topPx + b.heightPx).toBe(24 * HOUR_PX);
  });
});

describe("layoutDay lane packing", () => {
  it("gives non-overlapping events the full width", () => {
    const blocks = layoutDay([ev(at(9), at(10)), ev(at(11), at(12)), ev(at(15), at(16))], DAY, HOUR_PX, MIN_PX);
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      expect(b.lanes).toBe(1);
      expect(b.lane).toBe(0);
    }
  });

  it("splits two overlapping events into two lanes", () => {
    const blocks = layoutDay([ev(at(9), at(11)), ev(at(10), at(12))], DAY, HOUR_PX, MIN_PX);
    expect(blocks.map((b) => b.lanes)).toEqual([2, 2]);
    expect(blocks.map((b) => b.lane).sort()).toEqual([0, 1]);
  });

  it("treats a back-to-back pair as non-overlapping", () => {
    // 9-10 and 10-11 touch but don't collide; halving them would be wrong.
    const blocks = layoutDay([ev(at(9), at(10)), ev(at(10), at(11))], DAY, HOUR_PX, MIN_PX);
    expect(blocks.map((b) => b.lanes)).toEqual([1, 1]);
  });

  it("does not let a 9am collision narrow a 3pm event", () => {
    // Lanes are packed per cluster, not per day — the whole point.
    const blocks = layoutDay(
      [ev(at(9), at(11), "a"), ev(at(10), at(12), "b"), ev(at(15), at(16), "c")],
      DAY, HOUR_PX, MIN_PX,
    );
    const byId = new Map(blocks.map((b) => [b.ev.id, b]));
    expect(byId.get("a")!.lanes).toBe(2);
    expect(byId.get("b")!.lanes).toBe(2);
    expect(byId.get("c")!.lanes).toBe(1);
  });

  it("reuses a lane once its event has ended within the same cluster", () => {
    // a 9-12 spans the cluster; b 9-10 and c 10-11 chain in lane 1.
    const blocks = layoutDay(
      [ev(at(9), at(12), "a"), ev(at(9), at(10), "b"), ev(at(10), at(11), "c")],
      DAY, HOUR_PX, MIN_PX,
    );
    const byId = new Map(blocks.map((b) => [b.ev.id, b]));
    expect(byId.get("a")!.lane).toBe(0);
    expect(byId.get("b")!.lane).toBe(1);
    expect(byId.get("c")!.lane).toBe(1);
    for (const b of blocks) expect(b.lanes).toBe(2);
  });

  it("widens to three lanes for a three-way collision", () => {
    const blocks = layoutDay(
      [ev(at(9), at(12)), ev(at(9, 30), at(11)), ev(at(10), at(10, 30))],
      DAY, HOUR_PX, MIN_PX,
    );
    expect(blocks.map((b) => b.lanes)).toEqual([3, 3, 3]);
    expect(blocks.map((b) => b.lane).sort()).toEqual([0, 1, 2]);
  });

  it("gives the enclosing event the left lane on a shared start", () => {
    const blocks = layoutDay([ev(at(9), at(10), "short"), ev(at(9), at(12), "long")], DAY, HOUR_PX, MIN_PX);
    const byId = new Map(blocks.map((b) => [b.ev.id, b]));
    expect(byId.get("long")!.lane).toBe(0);
    expect(byId.get("short")!.lane).toBe(1);
  });

  it("returns nothing for an empty day", () => {
    expect(layoutDay([], DAY, HOUR_PX, MIN_PX)).toEqual([]);
  });
});
