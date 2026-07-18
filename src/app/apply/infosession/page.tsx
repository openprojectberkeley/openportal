"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
// ── Update these two dates for each recruitment cycle ──────────────────────
const SESSIONS = [
  { date: new Date("2026-07-14T19:00:00-07:00"), label: "Monday, July 14, 2026 · 7:00 – 9:00 PM PT" },
  { date: new Date("2026-07-21T19:00:00-07:00"), label: "Monday, July 21, 2026 · 7:00 – 9:00 PM PT" },
] as const;

const EVENT_TITLE    = "Open Project Berkeley – Infosession";
const EVENT_DETAILS  = "Come learn about Open Project Berkeley and meet the team!";
const EVENT_LOCATION = "UC Berkeley Campus";
const DURATION_MS    = 2 * 60 * 60 * 1000; // 2 hours

function toGcalDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function gcalUrl(session: { date: Date }) {
  const start = toGcalDate(session.date);
  const end   = toGcalDate(new Date(session.date.getTime() + DURATION_MS));
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(EVENT_TITLE)}` +
    `&dates=${start}/${end}` +
    `&details=${encodeURIComponent(EVENT_DETAILS)}` +
    `&location=${encodeURIComponent(EVENT_LOCATION)}`
  );
}

function toIcsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function downloadIcs(session: { date: Date }) {
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Open Project Berkeley//EN",
    "BEGIN:VEVENT",
    `DTSTART:${toIcsDate(session.date)}`,
    `DTEND:${toIcsDate(new Date(session.date.getTime() + DURATION_MS))}`,
    `SUMMARY:${EVENT_TITLE}`,
    `DESCRIPTION:${EVENT_DETAILS}`,
    `LOCATION:${EVENT_LOCATION}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([content], { type: "text/calendar" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "infosession.ics";
  a.click();
  URL.revokeObjectURL(url);
}

export default function InfosessionPage() {
  const router = useRouter();
  const [attendanceOpen, setAttendanceOpen] = useState(false);

  useEffect(() => {
    setAttendanceOpen(true);
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/apply" className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <h1 className="text-2xl font-bold">Infosession</h1>
        <p className="text-sm text-muted-foreground">
          Attend either session below — both cover the same content.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {SESSIONS.map((session, i) => {
          return (
            <div key={i} className="border rounded-xl p-5 flex flex-col gap-4">
              <p className="font-medium">{session.label}</p>
              <div className="flex gap-2 flex-wrap">
                <a
                  href={gcalUrl(session)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center border rounded-md px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  Add to Google Calendar
                </a>
                <button
                  onClick={() => downloadIcs(session)}
                  className="inline-flex items-center border rounded-md px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  Download .ics
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Attended an infosession? Submit your attendance below.
        </p>
        {attendanceOpen ? (
          <button
            onClick={() => router.push("/apply/infosession/attend")}
            className="w-full rounded-md bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-80 transition-opacity"
          >
            Submit Attendance
          </button>
        ) : (
          <div className="group relative w-full">
            <button
              disabled
              className="w-full rounded-md bg-foreground text-background px-4 py-2.5 text-sm font-medium opacity-30 cursor-not-allowed"
            >
              Submit Attendance
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md bg-foreground text-background text-xs px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              Available at infosession time
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
