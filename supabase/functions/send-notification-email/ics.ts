// Server-side iCalendar (.ics) invite builder for the notification emails.
//
// A framework-free sibling of src/lib/ics.ts, extended with the fields a real
// email invite needs so mail apps (Gmail, Apple Mail, Outlook) surface an
// add-to-calendar / RSVP card and honor later updates and cancellations:
// METHOD, STATUS, ORGANIZER, ATTENDEE, SEQUENCE. Times are emitted as UTC (Z),
// which every calendar renders in the recipient's own zone — so the invite is
// timezone-correct on its own, independent of members.timezone.
//
// UID is the coffee-chat id, kept STABLE across the booked/location/cancel
// lifecycle so all three land on the same calendar event; SEQUENCE increases
// per message so updates and cancels are accepted.

export type IcsMethod = "REQUEST" | "CANCEL";

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
  attendeeEmail: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

// UTC timestamp form: YYYYMMDDTHHMMSSZ
function toIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeText(s: string): string {
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
    `SUMMARY:${escapeText(inv.summary)}`,
    `STATUS:${status}`,
    `ORGANIZER;CN=${escapeText(inv.organizerName)}:mailto:${inv.organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${inv.attendeeEmail}`,
  ];

  if (inv.location) lines.push(`LOCATION:${escapeText(inv.location)}`);
  if (inv.description) lines.push(`DESCRIPTION:${escapeText(inv.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}
