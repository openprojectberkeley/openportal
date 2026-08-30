// Server-side iCalendar (.ics) invite builder for the notification emails.
//
// A framework-free sibling of src/lib/ics.ts. Emits a group event: one UID per
// SLOT (host + meeting_time) shared by every seat, an ORGANIZER, and one ATTENDEE
// line per party (host + booked applicants). METHOD:REQUEST adds/updates the
// shared event — a new booker is added to the same event rather than getting a
// duplicate; METHOD:CANCEL removes one recipient's copy when they leave.
//
// REQUEST solicits RSVP replies to the ORGANIZER address, so that address MUST be
// able to receive mail (see the plan's prerequisite) or accepts/declines bounce.
// RSVP=FALSE reduces the prompt but does not eliminate manual replies.
//
// Times are emitted as UTC (Z); every calendar renders them in the recipient's
// own zone, so the invite is timezone-correct on its own.

export type IcsMethod = "REQUEST" | "CANCEL";

export type IcsAttendee = { name: string; email: string };

export type IcsInvite = {
  method: IcsMethod;
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  organizerName: string;
  organizerEmail: string;
  attendees: IcsAttendee[];
};

const pad = (n: number) => String(n).padStart(2, "0");

// UTC timestamp form: YYYYMMDDTHHMMSSZ
function toIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildInvite(inv: IcsInvite): string {
  const status = inv.method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenPortal//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${inv.method}`,
    "BEGIN:VEVENT",
    `UID:${inv.uid}`,
    `SEQUENCE:${inv.sequence}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(inv.start)}`,
    `DTEND:${toIcsUtc(inv.end)}`,
    `SUMMARY:${escapeIcsText(inv.summary)}`,
    `STATUS:${status}`,
    `ORGANIZER;CN=${escapeIcsText(inv.organizerName)}:mailto:${inv.organizerEmail}`,
  ];

  for (const a of inv.attendees) {
    lines.push(
      `ATTENDEE;CN=${escapeIcsText(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${a.email}`,
    );
  }

  if (inv.location) lines.push(`LOCATION:${escapeIcsText(inv.location)}`);
  if (inv.description) lines.push(`DESCRIPTION:${escapeIcsText(inv.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}
