import { describe, expect, it } from "vitest";
import { absenceStreak, deriveAttendanceAnalytics, riskReasons, type AttendanceRaw } from "@/lib/attendance-analytics";

const NOW = new Date("2026-11-19T12:00:00Z");
const WIN = { startsOn: "2026-08-15", endsOn: "2026-12-20" };

const BASE_EVENTS: AttendanceRaw["events"] = [
  { id: "e1", portal_id: "pA", title: "A1", category: "general", start_time: "2026-09-01T18:00:00Z" },
  { id: "e2", portal_id: "pA", title: "A2", category: "general", start_time: "2026-09-08T18:00:00Z" },
  { id: "e3", portal_id: "pA", title: "A3", category: "general", start_time: "2026-09-15T18:00:00Z" },
  { id: "gm", portal_id: null, title: "GM", category: "gm", start_time: "2026-09-10T01:00:00Z" },
];

function raw(overrides: Partial<AttendanceRaw> = {}): AttendanceRaw {
  return {
    events: BASE_EVENTS,
    projects: [
      { portal_id: "pA", project_id: "A", name: "Alpha", color: null },
      { portal_id: "pB", project_id: "B", name: "Beta", color: null },
    ],
    rosters: [
      { portal_id: "pA", user_id: "u1" },
      { portal_id: "pA", user_id: "u2" },
      { portal_id: "pB", user_id: "u3" },
    ],
    members: [
      { user_id: "u1", name: "Ann", active: true },
      { user_id: "u2", name: "Bo", active: true },
      { user_id: "u3", name: "Cy", active: true },
    ],
    marks: [
      { event_id: "e1", user_id: "u1", status: "present" },
      { event_id: "e1", user_id: "u2", status: "absent" },
      { event_id: "e2", user_id: "u1", status: "present" },
      // e3 never marked
    ],
    ...overrides,
  };
}

describe("absenceStreak", () => {
  it("counts leading absences only", () => {
    expect(absenceStreak(["absent", "absent", "present", "absent"])).toBe(2);
    expect(absenceStreak(["excused", "absent"])).toBe(0);
    expect(absenceStreak([])).toBe(0);
  });
});

describe("riskReasons", () => {
  const none = { counts: { present: 0, absent: 0, excused: 0 }, attendance: null, streak: 0 };
  it("needs a minimum of marks per kind", () => {
    expect(riskReasons({ project: { counts: { present: 0, absent: 2, excused: 0 }, attendance: 0, streak: 2 }, gm: none })).toEqual([]);
  });
  it("labels reasons by kind", () => {
    expect(
      riskReasons({
        project: { counts: { present: 2, absent: 3, excused: 0 }, attendance: 40, streak: 3 },
        gm: { counts: { present: 3, absent: 0, excused: 0 }, attendance: 100, streak: 0 },
      }),
    ).toEqual(["40% project attendance", "3 project absences in a row"]);
    expect(
      riskReasons({ project: none, gm: { counts: { present: 1, absent: 2, excused: 0 }, attendance: 33, streak: 2 } }),
    ).toEqual(["33% GM attendance", "2 GM absences in a row"]);
  });
});

describe("deriveAttendanceAnalytics", () => {
  it("computes project-meeting fill-out against the roster", () => {
    const a = deriveAttendanceAnalytics(raw(), WIN, NOW);
    const alpha = a.projects.find((p) => p.name === "Alpha")!;
    expect(alpha.project).toMatchObject({ held: 3, taken: 2, slots: 6, marked: 3, fillOut: 50, untakenSinceLast: 1 });
    expect(alpha.project.lastTaken).toBe("2026-09-08T18:00:00Z");
    expect(a.headline.project).toMatchObject({ meetings: 3, fillOut: 50 });
  });

  it("gives untracked projects zeros, sorted first", () => {
    const a = deriveAttendanceAnalytics(raw(), WIN, NOW);
    const beta = a.projects.find((p) => p.name === "Beta")!;
    expect(beta.project).toMatchObject({ held: 0, taken: 0, fillOut: 0, attendance: 0, lastTaken: null });
    expect(a.projects[0].name).toBe("Beta");
  });

  it("keeps GMs out of project meetings and scores GM fill-out per project roster", () => {
    const a = deriveAttendanceAnalytics(
      raw({ marks: [...raw().marks, { event_id: "gm", user_id: "u1", status: "present" }] }),
      WIN,
      NOW,
    );
    const alpha = a.projects.find((p) => p.name === "Alpha")!;
    expect(alpha.project.held).toBe(3);
    expect(alpha.gm).toMatchObject({ held: 1, slots: 2, marked: 1, fillOut: 50, attendance: 100 });
    expect(a.projects.find((p) => p.name === "Beta")!.gm).toMatchObject({ slots: 1, marked: 0, fillOut: 0 });
    expect(a.headline.gm).toMatchObject({ meetings: 1, fillOut: 33, attendance: 100 });
  });

  it("excludes cancelled, future and out-of-window events", () => {
    const a = deriveAttendanceAnalytics(
      raw({
        events: [
          ...BASE_EVENTS,
          { id: "x1", portal_id: "pA", title: "C", category: "general", start_time: "2026-09-20T18:00:00Z", cancelled_at: "2026-09-19T00:00:00Z" },
          { id: "x2", portal_id: "pA", title: "F", category: "general", start_time: "2026-12-01T18:00:00Z" },
          { id: "x3", portal_id: "pA", title: "O", category: "general", start_time: "2026-05-01T18:00:00Z" },
        ],
      }),
      WIN,
      NOW,
    );
    expect(a.projects.find((p) => p.name === "Alpha")!.project.held).toBe(3);
  });

  it("ignores unmarked meetings in member stats", () => {
    const a = deriveAttendanceAnalytics(raw(), WIN, NOW);
    // Ann: marked present twice, e3 and the GM unmarked.
    const ann = a.members.find((m) => m.userId === "u1")!;
    expect(ann.project).toEqual({ counts: { present: 2, absent: 0, excused: 0 }, attendance: 100, streak: 0 });
    expect(ann.gm).toEqual({ counts: { present: 0, absent: 0, excused: 0 }, attendance: null, streak: 0 });
    expect(ann.risk).toEqual([]);
  });

  it("tracks project and GM streaks and risk separately", () => {
    const a = deriveAttendanceAnalytics(
      raw({
        marks: [
          { event_id: "e1", user_id: "u2", status: "present" },
          { event_id: "e2", user_id: "u2", status: "absent" },
          { event_id: "e3", user_id: "u2", status: "absent" },
          { event_id: "gm", user_id: "u2", status: "present" },
        ],
      }),
      WIN,
      NOW,
    );
    const bo = a.members.find((m) => m.userId === "u2")!;
    expect(bo.project).toMatchObject({ streak: 2, attendance: 33 });
    expect(bo.gm).toMatchObject({ streak: 0, attendance: 100 });
    expect(bo.risk).toEqual(["33% project attendance", "2 project absences in a row"]);
    expect(a.atRisk.map((m) => m.userId)).toEqual(["u2"]);
  });

  it("summarises GMs and ranks most-missed by absences only", () => {
    const a = deriveAttendanceAnalytics(
      raw({
        marks: [
          { event_id: "gm", user_id: "u1", status: "present" },
          { event_id: "gm", user_id: "u2", status: "absent" },
        ],
      }),
      WIN,
      NOW,
    );
    expect(a.gms[0]).toMatchObject({ id: "gm", expected: 3, unmarked: 1, counts: { present: 1, absent: 1, excused: 0 } });
    // Cy is unmarked, not absent, so isn't listed.
    expect(a.gmMisses).toEqual([{ userId: "u2", name: "Bo", absent: 1, attended: 0 }]);
  });
});
