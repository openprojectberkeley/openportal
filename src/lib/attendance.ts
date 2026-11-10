// A member's own attendance record (portal_event_attendance, 0011/0095).

export type AttendanceStatus = "present" | "absent" | "excused";

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
};

// Same green/red/yellow as the attendance-taking grid (portal-attendance-modal).
export const ATTENDANCE_STATUS_PILL: Record<AttendanceStatus, string> = {
  present: "bg-green-500 text-white",
  absent: "bg-red-500 text-white",
  excused: "bg-yellow-400 text-black",
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
