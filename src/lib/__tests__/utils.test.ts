import { describe, expect, it } from "vitest";
import { compareReviewPriority, daysLate, isLate, isRecruitingValid } from "@/lib/utils";

const ENDS = "2026-09-01T07:00:00.000Z";
const ON_TIME = "2026-08-31T12:00:00.000Z";
const LATE = "2026-09-02T12:00:00.000Z";
const LATER = "2026-09-03T12:00:00.000Z";

describe("isLate", () => {
  it("is true only when submitted after ends_at", () => {
    expect(isLate(LATE, ENDS)).toBe(true);
    expect(isLate(ON_TIME, ENDS)).toBe(false);
    expect(isLate(ENDS, ENDS)).toBe(false);
  });

  it("is false when either timestamp is missing", () => {
    expect(isLate(null, ENDS)).toBe(false);
    expect(isLate(LATE, null)).toBe(false);
  });
});

describe("daysLate", () => {
  it("rounds up so any lateness counts as at least one day", () => {
    expect(daysLate(LATE, ENDS)).toBe(2);
    expect(daysLate(ON_TIME, ENDS)).toBe(0);
  });
});

describe("isRecruitingValid", () => {
  const base = { coffeeDone: true, infosession: true };

  it("requires coffee done and infosession for first-timers", () => {
    expect(isRecruitingValid(base)).toBe(true);
    expect(isRecruitingValid({ ...base, coffeeDone: false })).toBe(false);
    expect(isRecruitingValid({ ...base, infosession: false })).toBe(false);
  });

  it("lets board/exec and returning stay valid without coffee/info", () => {
    expect(
      isRecruitingValid({ boardExec: true, coffeeDone: false, infosession: false }),
    ).toBe(true);
    expect(
      isRecruitingValid({ returning: true, coffeeDone: false, infosession: false }),
    ).toBe(true);
  });
});

describe("compareReviewPriority", () => {
  const row = (returning: boolean, submittedAt: string | null, valid = true) => ({
    returning,
    submittedAt,
    valid,
  });

  it("puts returning members above first-timers", () => {
    expect(compareReviewPriority(row(true, ON_TIME), row(false, ON_TIME), ENDS)).toBeLessThan(0);
  });

  it("puts late submissions below on-time ones of the same returning status", () => {
    expect(compareReviewPriority(row(false, ON_TIME), row(false, LATE), ENDS)).toBeLessThan(0);
    expect(compareReviewPriority(row(true, ON_TIME), row(true, LATE), ENDS)).toBeLessThan(0);
  });

  it("lets returning win over late, so returning-but-late still beats first-time on-time", () => {
    expect(compareReviewPriority(row(true, LATE), row(false, ON_TIME), ENDS)).toBeLessThan(0);
  });

  it("puts invalid below late of the same returning status", () => {
    expect(compareReviewPriority(row(false, LATE, true), row(false, ON_TIME, false), ENDS)).toBeLessThan(0);
    expect(compareReviewPriority(row(false, LATE, true), row(false, LATE, false), ENDS)).toBeLessThan(0);
  });

  it("lets returning win over invalid", () => {
    expect(compareReviewPriority(row(true, ON_TIME, false), row(false, ON_TIME, true), ENDS)).toBeLessThan(0);
  });

  it("keeps earliest submitted_at first within the same returning/late/valid bucket", () => {
    expect(compareReviewPriority(row(false, LATE), row(false, LATER), ENDS)).toBeLessThan(0);
  });

  it("sorts a mixed list into returning → late → invalid-last order", () => {
    const mixed = [
      row(false, LATE, false),
      row(false, LATE, true),
      row(true, LATE, true),
      row(false, ON_TIME, true),
      row(true, ON_TIME, true),
      row(false, ON_TIME, false),
    ];
    mixed.sort((a, b) => compareReviewPriority(a, b, ENDS));
    expect(mixed).toEqual([
      row(true, ON_TIME, true),
      row(true, LATE, true),
      row(false, ON_TIME, true),
      row(false, LATE, true),
      row(false, ON_TIME, false),
      row(false, LATE, false),
    ]);
  });
});
