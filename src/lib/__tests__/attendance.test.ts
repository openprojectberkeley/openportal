import { describe, expect, it } from "vitest";
import { attendanceRate, countAttendance, inSemester } from "@/lib/attendance";

describe("countAttendance", () => {
  it("tallies each status", () => {
    expect(countAttendance(["present", "present", "absent", "excused"])).toEqual({
      present: 2,
      absent: 1,
      excused: 1,
    });
  });
});

describe("attendanceRate", () => {
  it("counts excused as half attended", () => {
    // (2 + 0.5) / 4 = 62.5 -> 63
    expect(attendanceRate({ present: 2, absent: 1, excused: 1 })).toBe(63);
    expect(attendanceRate({ present: 0, absent: 0, excused: 2 })).toBe(50);
  });

  it("is null with nothing to rate", () => {
    expect(attendanceRate({ present: 0, absent: 0, excused: 0 })).toBeNull();
  });
});

describe("inSemester", () => {
  it("is inclusive on both ends", () => {
    expect(inSemester("2026-08-20T18:00:00Z", "2026-08-20", "2026-12-15")).toBe(true);
    expect(inSemester("2026-12-15T18:00:00Z", "2026-08-20", "2026-12-15")).toBe(true);
    expect(inSemester("2026-12-16T18:00:00Z", "2026-08-20", "2026-12-15")).toBe(false);
  });

  it("treats missing bounds as open", () => {
    expect(inSemester("2020-01-01T00:00:00Z", null, null)).toBe(true);
  });
});
