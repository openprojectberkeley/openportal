import { describe, expect, it } from "vitest";
import {
  compareReviewPriority,
  daysLate,
  isLate,
  isRecruitingValid,
  isSeverelyLate,
} from "@/lib/utils";

const ENDS = "2026-09-01T07:00:00.000Z";
const ON_TIME = "2026-08-31T12:00:00.000Z";
const LATE = "2026-09-02T12:00:00.000Z"; // 29h → daysLate 2
const LATER = "2026-09-03T12:00:00.000Z"; // 53h → daysLate 3
const EXACTLY_2D = "2026-09-03T07:00:00.000Z"; // exactly 48h → daysLate 2
const JUST_OVER_2D = "2026-09-03T07:00:00.001Z"; // 48h+1ms → daysLate 3

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

describe("isSeverelyLate", () => {
  it("is false at exactly 2 days late and true just after", () => {
    expect(isSeverelyLate(EXACTLY_2D, ENDS)).toBe(false);
    expect(daysLate(EXACTLY_2D, ENDS)).toBe(2);
    expect(isSeverelyLate(JUST_OVER_2D, ENDS)).toBe(true);
    expect(daysLate(JUST_OVER_2D, ENDS)).toBe(3);
    expect(isSeverelyLate(LATER, ENDS)).toBe(true);
  });

  it("is false when on-time or timestamps are missing", () => {
    expect(isSeverelyLate(ON_TIME, ENDS)).toBe(false);
    expect(isSeverelyLate(LATE, ENDS)).toBe(false);
    expect(isSeverelyLate(null, ENDS)).toBe(false);
    expect(isSeverelyLate(LATER, null)).toBe(false);
  });
});

describe("isRecruitingValid", () => {
  const base = {
    coffeeDone: true,
    infosession: true,
    submittedAt: ON_TIME,
    endsAt: ENDS,
  };

  it("requires coffee done, infosession, and not 3+ days late for first-timers", () => {
    expect(isRecruitingValid(base)).toBe(true);
    expect(isRecruitingValid({ ...base, coffeeDone: false })).toBe(false);
    expect(isRecruitingValid({ ...base, infosession: false })).toBe(false);
    expect(isRecruitingValid({ ...base, submittedAt: EXACTLY_2D })).toBe(true);
    expect(isRecruitingValid({ ...base, submittedAt: JUST_OVER_2D })).toBe(false);
  });

  it("lets board/exec and returning stay valid even when 3+ days late", () => {
    expect(
      isRecruitingValid({
        ...base,
        boardExec: true,
        coffeeDone: false,
        infosession: false,
        submittedAt: JUST_OVER_2D,
      }),
    ).toBe(true);
    expect(
      isRecruitingValid({
        ...base,
        returning: true,
        coffeeDone: false,
        infosession: false,
        submittedAt: JUST_OVER_2D,
      }),
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
