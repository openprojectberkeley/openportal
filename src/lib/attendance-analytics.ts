import { attendanceRate, inSemester, type AttendanceCounts, type AttendanceStatus } from "@/lib/attendance";

// Exec attendance analytics, derived client-side from plain table reads
// (useAttendanceAnalytics). Pure so it can be unit-tested.
//
// Two kinds of meeting, always reported separately:
//   * Project meeting: an attendance-enabled event on a project portal.
//   * General meeting (GM): an attendance-enabled club-wide event
//     (portal_id null), whoever marked it.
// Scope: past, non-cancelled events inside the window.
//
// There's no "attendance submitted" flag; a missing portal_event_attendance
// row just means nobody marked that person. Unmarked is a project's failure,
// never the member's:
//   * Project fill-out = marks ÷ (meetings × roster), per kind of meeting.
//     For GMs, the roster is the project's, so unmarked GM slots count against
//     the project the member is on.
//   * Member stats use marks only; an unmarked meeting changes nothing.
// Rosters are today's portal_members, so someone who joined mid-semester counts
// as expected for meetings before they joined.

export const AT_RISK_RATE = 70;
export const AT_RISK_STREAK = 2;
export const AT_RISK_MIN_MARKED = 3;

// ---- raw rows -------------------------------------------------------------

export type RawEvent = {
  id: string;
  portal_id: string | null;
  title: string;
  category: string;
  start_time: string;
  cancelled_at?: string | null;
};
export type RawProject = { portal_id: string; project_id: string; name: string; color: string | null };
export type RawRoster = { portal_id: string; user_id: string };
export type RawMember = { user_id: string; name: string; active: boolean };
export type RawMark = { event_id: string; user_id: string; status: AttendanceStatus };

export type AttendanceRaw = {
  events: RawEvent[];
  projects: RawProject[];
  rosters: RawRoster[];
  members: RawMember[];
  marks: RawMark[];
};

export type Window = { startsOn: string | null; endsOn: string | null };

// ---- derived --------------------------------------------------------------

/** One project's numbers for one kind of meeting. */
export type ScopeStat = {
  held: number;
  /** Meetings with at least one mark from the roster. */
  taken: number;
  slots: number;
  marked: number;
  /** marked ÷ slots, 0–100 (0 with nothing held). */
  fillOut: number;
  /** Of what was marked; 0 with no marks. */
  attendance: number;
  counts: AttendanceCounts;
  /** start_time of the latest meeting with any mark. */
  lastTaken: string | null;
  /** Meetings since the last taken one (0 when the latest was marked). */
  untakenSinceLast: number;
};

export type ProjectStat = {
  portalId: string;
  projectId: string;
  name: string;
  color: string | null;
  roster: number;
  project: ScopeStat;
  gm: ScopeStat;
};

/** A member's marks for one kind of meeting. */
export type MemberScope = {
  counts: AttendanceCounts;
  /** Null with no marks. */
  attendance: number | null;
  /** Consecutive absences counting back from the latest mark. */
  streak: number;
};

export type MemberStat = {
  userId: string;
  name: string;
  active: boolean;
  projects: { portalId: string; name: string; color: string | null }[];
  project: MemberScope;
  gm: MemberScope;
  /** Human-readable at-risk reasons; empty when not at risk. */
  risk: string[];
};

export type GmStat = {
  id: string;
  title: string;
  category: string;
  start_time: string;
  expected: number;
  counts: AttendanceCounts;
  unmarked: number;
};

export type GmMissStat = { userId: string; name: string; absent: number; attended: number };

export type HeadlineScope = { meetings: number; fillOut: number; attendance: number };

export type AttendanceAnalytics = {
  headline: { project: HeadlineScope; gm: HeadlineScope; atRisk: number };
  projects: ProjectStat[];
  members: MemberStat[];
  atRisk: MemberStat[];
  gms: GmStat[];
  gmMisses: GmMissStat[];
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const zero = (): AttendanceCounts => ({ present: 0, absent: 0, excused: 0 });
const marked = (c: AttendanceCounts) => c.present + c.absent + c.excused;

/**
 * Consecutive absences counting back from the latest mark. Statuses must be
 * newest first; an excused or present mark ends the run.
 */
export function absenceStreak(newestFirst: AttendanceStatus[]): number {
  let n = 0;
  for (const s of newestFirst) {
    if (s !== "absent") break;
    n += 1;
  }
  return n;
}

export function riskReasons(m: { project: MemberScope; gm: MemberScope }): string[] {
  const out: string[] = [];
  for (const [label, s] of [
    ["project", m.project],
    ["GM", m.gm],
  ] as const) {
    if (marked(s.counts) < AT_RISK_MIN_MARKED) continue;
    if (s.attendance != null && s.attendance < AT_RISK_RATE) out.push(`${s.attendance}% ${label} attendance`);
    if (s.streak >= AT_RISK_STREAK) out.push(`${s.streak} ${label} absences in a row`);
  }
  return out;
}

export function deriveAttendanceAnalytics(raw: AttendanceRaw, win: Window, now: Date = new Date()): AttendanceAnalytics {
  const nowIso = now.toISOString();
  const events = raw.events
    .filter((e) => !e.cancelled_at && e.start_time < nowIso && inSemester(e.start_time, win.startsOn, win.endsOn))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const eventIds = new Set(events.map((e) => e.id));

  const projectByPortal = new Map(raw.projects.map((p) => [p.portal_id, p]));
  const memberById = new Map(raw.members.map((m) => [m.user_id, m]));

  const rosterByPortal = new Map<string, Set<string>>();
  const portalsByUser = new Map<string, string[]>();
  for (const r of raw.rosters) {
    if (!projectByPortal.has(r.portal_id)) continue;
    let set = rosterByPortal.get(r.portal_id);
    if (!set) rosterByPortal.set(r.portal_id, (set = new Set()));
    if (set.has(r.user_id)) continue;
    set.add(r.user_id);
    const list = portalsByUser.get(r.user_id) ?? [];
    list.push(r.portal_id);
    portalsByUser.set(r.user_id, list);
  }

  const markBy = new Map<string, AttendanceStatus>();
  for (const m of raw.marks) if (eventIds.has(m.event_id)) markBy.set(`${m.event_id}:${m.user_id}`, m.status);
  const markOf = (eventId: string, userId: string) => markBy.get(`${eventId}:${userId}`);

  const gms = events.filter((e) => e.portal_id == null);
  const meetingsByPortal = new Map<string, RawEvent[]>();
  for (const p of raw.projects) meetingsByPortal.set(p.portal_id, []);
  for (const e of events) if (e.portal_id) meetingsByPortal.get(e.portal_id)?.push(e);

  // Oldest-first meetings against a roster.
  function scope(evs: RawEvent[], roster: Set<string>): ScopeStat {
    const counts = zero();
    let marks = 0;
    let taken = 0;
    let lastTaken: string | null = null;
    let untakenSinceLast = 0;
    for (const e of evs) {
      let n = 0;
      for (const u of roster) {
        const s = markOf(e.id, u);
        if (!s) continue;
        n += 1;
        counts[s] += 1;
      }
      marks += n;
      if (n > 0) {
        taken += 1;
        lastTaken = e.start_time;
        untakenSinceLast = 0;
      } else {
        untakenSinceLast += 1;
      }
    }
    const slots = evs.length * roster.size;
    return {
      held: evs.length,
      taken,
      slots,
      marked: marks,
      fillOut: pct(marks, slots),
      attendance: attendanceRate(counts) ?? 0,
      counts,
      lastTaken,
      untakenSinceLast,
    };
  }

  // ---- projects ----
  const projects: ProjectStat[] = raw.projects.map((p) => {
    const roster = rosterByPortal.get(p.portal_id) ?? new Set<string>();
    return {
      portalId: p.portal_id,
      projectId: p.project_id,
      name: p.name,
      color: p.color,
      roster: roster.size,
      project: scope(meetingsByPortal.get(p.portal_id) ?? [], roster),
      gm: scope(gms, roster),
    };
  });
  projects.sort((a, b) => a.project.fillOut - b.project.fillOut || a.name.localeCompare(b.name));

  // ---- general meetings ----
  const activeIds = raw.members.filter((m) => m.active).map((m) => m.user_id);
  const activeSet = new Set(activeIds);
  const gmStats: GmStat[] = gms
    .map((e) => {
      const counts = zero();
      for (const u of activeIds) {
        const s = markOf(e.id, u);
        if (s) counts[s] += 1;
      }
      return {
        id: e.id,
        title: e.title,
        category: e.category,
        start_time: e.start_time,
        expected: activeIds.length,
        counts,
        unmarked: activeIds.length - marked(counts),
      };
    })
    .reverse(); // newest first

  // ---- members ----
  const members: MemberStat[] = [];
  const memberScope = (evsNewestFirst: RawEvent[], userId: string): MemberScope => {
    const statuses: AttendanceStatus[] = [];
    for (const e of evsNewestFirst) {
      const s = markOf(e.id, userId);
      if (s) statuses.push(s);
    }
    const counts = zero();
    for (const s of statuses) counts[s] += 1;
    return { counts, attendance: attendanceRate(counts), streak: absenceStreak(statuses) };
  };
  const gmsNewest = [...gms].reverse();
  for (const userId of new Set([...activeIds, ...portalsByUser.keys()])) {
    const m = memberById.get(userId);
    const portals = portalsByUser.get(userId) ?? [];
    const meetings = new Map<string, RawEvent>();
    for (const pid of portals) for (const e of meetingsByPortal.get(pid) ?? []) meetings.set(e.id, e);
    const meetingsNewest = [...meetings.values()].sort((a, b) => b.start_time.localeCompare(a.start_time));
    const stat: MemberStat = {
      userId,
      name: m?.name ?? "Unknown",
      active: activeSet.has(userId),
      projects: portals.map((pid) => {
        const p = projectByPortal.get(pid)!;
        return { portalId: pid, name: p.name, color: p.color };
      }),
      project: memberScope(meetingsNewest, userId),
      gm: memberScope(gmsNewest, userId),
      risk: [],
    };
    if (marked(stat.project.counts) + marked(stat.gm.counts) === 0 && portals.length === 0) continue;
    stat.risk = riskReasons(stat);
    members.push(stat);
  }
  members.sort((a, b) => a.name.localeCompare(b.name));

  const lowest = (m: MemberStat) => Math.min(m.project.attendance ?? 100, m.gm.attendance ?? 100);
  const atRisk = members
    .filter((m) => m.risk.length > 0)
    .sort((a, b) => lowest(a) - lowest(b) || a.name.localeCompare(b.name));

  const gmMisses: GmMissStat[] = members
    .filter((m) => m.gm.counts.absent > 0)
    .map((m) => ({ userId: m.userId, name: m.name, absent: m.gm.counts.absent, attended: m.gm.counts.present }))
    .sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name));

  // ---- headline ----
  const projTotals = { slots: 0, marked: 0, meetings: 0, counts: zero() };
  for (const p of projects) {
    projTotals.slots += p.project.slots;
    projTotals.marked += p.project.marked;
    projTotals.meetings += p.project.held;
    for (const k of ["present", "absent", "excused"] as const) projTotals.counts[k] += p.project.counts[k];
  }
  const gmCounts = zero();
  for (const g of gmStats) for (const k of ["present", "absent", "excused"] as const) gmCounts[k] += g.counts[k];

  return {
    headline: {
      project: {
        meetings: projTotals.meetings,
        fillOut: pct(projTotals.marked, projTotals.slots),
        attendance: attendanceRate(projTotals.counts) ?? 0,
      },
      gm: {
        meetings: gms.length,
        fillOut: pct(marked(gmCounts), gms.length * activeIds.length),
        attendance: attendanceRate(gmCounts) ?? 0,
      },
      atRisk: atRisk.length,
    },
    projects,
    members,
    atRisk,
    gms: gmStats,
    gmMisses,
  };
}
