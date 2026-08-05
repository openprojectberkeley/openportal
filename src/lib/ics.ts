// Minimal iCalendar (.ics) generation for a single event + a browser download
// helper. No dependency; RFC 5545 basics only.

export type IcsEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

// UTC timestamp form: YYYYMMDDTHHMMSSZ
function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Floating date form for all-day events: YYYYMMDD (local calendar date).
function toIcsDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildIcs(ev: IcsEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenPortal//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${ev.id}@openportal`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
  ];

  if (ev.all_day) {
    // All-day DTEND is exclusive, so use the following day.
    const next = new Date(ev.start_time);
    next.setDate(next.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(ev.start_time)}`, `DTEND;VALUE=DATE:${toIcsDate(next.toISOString())}`);
  } else {
    const end = ev.end_time ?? new Date(new Date(ev.start_time).getTime() + 60 * 60 * 1000).toISOString();
    lines.push(`DTSTART:${toIcsUtc(ev.start_time)}`, `DTEND:${toIcsUtc(end)}`);
  }

  lines.push(`SUMMARY:${escapeText(ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}

export function downloadEventIcs(ev: IcsEvent): void {
  const blob = new Blob([buildIcs(ev)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ev.title.replace(/[^\w-]+/g, "_").slice(0, 50) || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
