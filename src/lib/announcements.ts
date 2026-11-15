export type Announcement = {
  id: string;
  message: string;
  color: string;
  starts_at: string;
  ends_at: string;
  /** Optional moment the banner counts down to (0110). */
  countdown_at?: string | null;
};

export type AnnouncementStatus = "scheduled" | "live" | "ended";

export function announcementStatus(a: Announcement, now = Date.now()): AnnouncementStatus {
  if (new Date(a.starts_at).getTime() > now) return "scheduled";
  if (new Date(a.ends_at).getTime() < now) return "ended";
  return "live";
}

// <input type="date"> value (YYYY-MM-DD) <-> ISO, in the viewer's local time.
// Start is the beginning of its day and end the last ms of its day, so the end
// date is inclusive.
export function dateInputToStartIso(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, 0, 0, 0, 0).toISOString();
}

export function dateInputToEndIso(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, 23, 59, 59, 999).toISOString();
}

export function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// <input type="datetime-local"> value (YYYY-MM-DDTHH:mm) <-> ISO, local time.
export function isoToDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Null for an empty or unparseable value (toISOString would throw). */
export function dateTimeLocalToIso(v: string): string | null {
  const d = new Date(v);
  return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}
