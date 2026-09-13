// Unit tests for src/lib/event-days.ts — the day-span bucketing behind the
// calendar's month grid. Vitest pins TZ=UTC (vitest.config.ts), so the local
// day keys here are deterministic.

import { describe, expect, it } from "vitest";
import { dayKey, dayKeysFor } from "@/lib/event-days";

describe("dayKeysFor", () => {
  it("gives a single-day event one key", () => {
    expect(dayKeysFor({ start_time: "2026-09-17T20:00:00Z", end_time: "2026-09-17T21:00:00Z" }))
      .toEqual(["2026-09-17"]);
  });

  it("spans the real two-day club retreat", () => {
    // As the sync stores it: inclusive end, pulled back from Google's
    // exclusive all-day DTEND of 2026-09-28.
    expect(dayKeysFor({ start_time: "2026-09-26T00:00:00Z", end_time: "2026-09-27T00:00:00Z" }))
      .toEqual(["2026-09-26", "2026-09-27"]);
  });

  it("spans a long event across a month boundary", () => {
    expect(dayKeysFor({ start_time: "2026-10-30T10:00:00Z", end_time: "2026-11-02T10:00:00Z" }))
      .toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("handles a missing end time", () => {
    expect(dayKeysFor({ start_time: "2026-09-17T20:00:00Z", end_time: null })).toEqual(["2026-09-17"]);
  });

  it("ignores an end before the start rather than looping", () => {
    expect(dayKeysFor({ start_time: "2026-09-17T20:00:00Z", end_time: "2026-09-01T00:00:00Z" }))
      .toEqual(["2026-09-17"]);
  });

  it("caps a runaway span instead of hanging", () => {
    const keys = dayKeysFor({ start_time: "2026-01-01T00:00:00Z", end_time: "2030-01-01T00:00:00Z" });
    expect(keys.length).toBeLessThanOrEqual(61);
  });

  it("survives an unparseable date", () => {
    expect(dayKeysFor({ start_time: "not a date", end_time: null })).toEqual([]);
    expect(dayKeysFor({ start_time: "2026-09-17T20:00:00Z", end_time: "nonsense" }))
      .toEqual(["2026-09-17"]);
  });

  it("pads dayKey to a stable YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
