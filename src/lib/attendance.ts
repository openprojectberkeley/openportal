// A member's own attendance record (portal_event_attendance, 0011/0095).

export type AttendanceStatus = "present" | "absent" | "excused";

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
};

// Soft status tints from the theme's status tokens (globals.css), so a long
// list of records reads calm rather than as a wall of saturated pills.
export const ATTENDANCE_STATUS_PILL: Record<AttendanceStatus, string> = {
  present: "bg-success/15 text-success",
  absent: "bg-destructive/15 text-destructive",
  excused: "bg-warning/15 text-warning",
};

export type AttendanceCounts = Record<AttendanceStatus, number>;

export function countAttendance(statuses: AttendanceStatus[]): AttendanceCounts {
  const counts: AttendanceCounts = { present: 0, absent: 0, excused: 0 };
  for (const s of statuses) counts[s] += 1;
  return counts;
}

/**
 * (present + ½ × excused) ÷ all recorded events, as a 0–100 integer. An excused
 * absence counts as half attended. Null when there's nothing to rate.
 */
export function attendanceRate(counts: AttendanceCounts): number | null {
  const total = counts.present + counts.absent + counts.excused;
  if (total === 0) return null;
  return Math.round(((counts.present + counts.excused / 2) / total) * 100);
}

/** Whether an ISO timestamp falls within a semester's inclusive date range. */
export function inSemester(
  iso: string,
  startsOn: string | null,
  endsOn: string | null,
): boolean {
  const day = iso.slice(0, 10);
  if (startsOn && day < startsOn) return false;
  if (endsOn && day > endsOn) return false;
  return true;
}
