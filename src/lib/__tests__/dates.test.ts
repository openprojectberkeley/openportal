import { describe, expect, it } from "vitest";
import {
  addDays,
  dateFromKey,
  formatHour,
  monthMatrix,
  parseLocalDate,
  shortTime,
  startOfDay,
  startOfWeek,
  mondayOf,
  weekdayLabels,
  weekDays,
} from "@/lib/dates";
import { dayKey } from "@/lib/event-days";

// TZ is pinned to UTC by vitest.config.ts, so local time is UTC here.

describe("parseLocalDate", () => {
  it("parses a day key as local midnight", () => {
    const d = parseLocalDate("2026-10-06")!;
    expect(dayKey(d)).toBe("2026-10-06");
    expect(d.getHours()).toBe(0);
  });

  it("returns null rather than an Invalid Date for garbage", () => {
    // The URL's ?date= lands here; an Invalid Date would render 42 NaN cells.
    for (const bad of ["", "not-a-date", "2026-10", "10/06/2026", "2026-13-01"]) {
      expect(parseLocalDate(bad)).toBeNull();
    }
  });

  it("rejects a day that doesn't exist instead of rolling it forward", () => {
    expect(parseLocalDate("2026-02-31")).toBeNull();
  });
});

describe("monthMatrix", () => {
  it("always returns 42 days, so the grid height never changes", () => {
    for (const [y, m] of [[2026, 1], [2026, 9], [2024, 1], [2026, 2]] as const) {
      expect(monthMatrix(y, m)).toHaveLength(42);
    }
  });

  it("starts on the configured week start and brackets the month", () => {
    // Oct 2026 starts on a Thursday, so a Sunday-first grid leads with Sep 27.
    const cells = monthMatrix(2026, 9, 0);
    expect(dayKey(cells[0])).toBe("2026-09-27");
    expect(cells[0].getDay()).toBe(0);
    expect(dayKey(cells[41])).toBe("2026-11-07");
  });

  it("honors a Monday week start", () => {
    const cells = monthMatrix(2026, 9, 1);
    expect(cells[0].getDay()).toBe(1);
    expect(dayKey(cells[0])).toBe("2026-09-28");
  });

  it("shows a leading spill week when the month starts on the week start", () => {
    // Nov 2026 starts on a Sunday: no lead, so the grid runs a full week past.
    const cells = monthMatrix(2026, 10, 0);
    expect(dayKey(cells[0])).toBe("2026-11-01");
    expect(dayKey(cells[41])).toBe("2026-12-12");
  });
});

describe("addDays", () => {
  it("moves by calendar days, keeping the wall-clock time", () => {
    const d = new Date(2026, 9, 6, 18, 30);
    const next = addDays(d, 1);
    expect(dayKey(next)).toBe("2026-10-07");
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(30);
  });

  it("crosses month and year boundaries", () => {
    expect(dayKey(addDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
    expect(dayKey(addDays(new Date(2026, 0, 1), -1))).toBe("2025-12-31");
  });
});

describe("startOfDay / startOfWeek / weekDays", () => {
  it("floors to local midnight", () => {
    const d = startOfDay(new Date(2026, 9, 6, 23, 59, 59));
    expect(d.getHours()).toBe(0);
    expect(dayKey(d)).toBe("2026-10-06");
  });

  it("finds the Sunday and the Monday of a week", () => {
    const tue = new Date(2026, 9, 6); // a Tuesday
    expect(dayKey(startOfWeek(tue, 0))).toBe("2026-10-04");
    expect(dayKey(mondayOf(tue))).toBe("2026-10-05");
  });

  it("is a no-op on a day that is already the week start", () => {
    const sun = new Date(2026, 9, 4);
    expect(dayKey(startOfWeek(sun, 0))).toBe("2026-10-04");
  });

  it("returns 7 consecutive days", () => {
    const days = weekDays(new Date(2026, 9, 6), 0);
    expect(days.map(dayKey)).toEqual([
      "2026-10-04", "2026-10-05", "2026-10-06",
      "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
    ]);
  });
});

describe("weekdayLabels", () => {
  it("rotates to the week start", () => {
    expect(weekdayLabels(0)[0]).toBe("Sun");
    expect(weekdayLabels(1)[0]).toBe("Mon");
    expect(weekdayLabels(1)[6]).toBe("Sun");
  });
});

describe("formatHour", () => {
  it("renders 12-hour labels with no zero hour", () => {
    expect(formatHour(0)).toBe("12am");
    expect(formatHour(9)).toBe("9am");
    expect(formatHour(12)).toBe("12pm");
    expect(formatHour(18)).toBe("6pm");
    expect(formatHour(23)).toBe("11pm");
  });
});

describe("shortTime", () => {
  it("drops :00 and the space so a chip can carry a time at 11px", () => {
    expect(shortTime("2026-10-06T18:00:00Z")).toBe("6p");
    expect(shortTime("2026-10-06T18:30:00Z")).toBe("6:30p");
    expect(shortTime("2026-10-06T09:05:00Z")).toBe("9:05a");
    expect(shortTime("2026-10-06T00:00:00Z")).toBe("12a");
    expect(shortTime("2026-10-06T12:00:00Z")).toBe("12p");
  });
});

describe("dateFromKey", () => {
  it("parses as local midnight, not UTC midnight", () => {
    // A bare new Date("2026-10-06") is UTC midnight, which prints as Oct 5
    // anywhere west of Greenwich.
    expect(dayKey(dateFromKey("2026-10-06"))).toBe("2026-10-06");
    expect(dateFromKey("2026-10-06").getHours()).toBe(0);
  });
});
