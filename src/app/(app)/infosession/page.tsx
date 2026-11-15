"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { staggerStyle } from "@/lib/motion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { ArrowRight, CalendarPlus, Download } from "lucide-react";
// ── Update these two dates for each recruitment cycle ──────────────────────
const SESSIONS = [
  { date: new Date("2026-08-31T20:00:00-07:00"), label: "Monday, August 31, 2026 · 8:00 – 9:30 PM PT · GPBB 100", location: "GPBB 100" },
  { date: new Date("2026-09-04T20:00:00-07:00"), label: "Friday, September 4, 2026 · 8:00 – 9:30 PM PT · VLSB 2040", location: "VLSB 2040" },
] as const;

const EVENT_TITLE    = "Open Project Berkeley – Infosession";
const EVENT_DETAILS  = "Come learn about Open Project Berkeley and meet the team!";
const DURATION_MS    = 90 * 60 * 1000; // 1.5 hours

function toGcalDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function gcalUrl(session: { date: Date; location: string }) {
  const start = toGcalDate(session.date);
  const end   = toGcalDate(new Date(session.date.getTime() + DURATION_MS));
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(EVENT_TITLE)}` +
    `&dates=${start}/${end}` +
    `&details=${encodeURIComponent(EVENT_DETAILS)}` +
    `&location=${encodeURIComponent(session.location)}`
  );
}

function toIcsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function downloadIcs(session: { date: Date; location: string }) {
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Open Project Berkeley//EN",
    "BEGIN:VEVENT",
    `DTSTART:${toIcsDate(session.date)}`,
    `DTEND:${toIcsDate(new Date(session.date.getTime() + DURATION_MS))}`,
    `SUMMARY:${EVENT_TITLE}`,
    `DESCRIPTION:${EVENT_DETAILS}`,
    `LOCATION:${session.location}`,
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
        <BackLink href="/" label="Dashboard" />
        <h1 className="text-2xl font-bold tracking-tight">Infosession</h1>
        <p className="text-sm text-muted-foreground">Both sessions cover the same content; attend either one.</p>
      </div>

      <div className="flex flex-col gap-1">
        {SESSIONS.map((session, i) => {
          const [day, ...rest] = session.label.split(" · ");
          return (
            <div
              key={i}
              className="flex items-center gap-4 rounded-lg px-4 py-3 -mx-4 hover:bg-foreground/[0.03] animate-fade-in-up"
              style={staggerStyle(i)}
            >
              <span aria-hidden className="w-1 self-stretch rounded-full bg-foreground/80" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{day}</span>
                <span className="text-sm text-muted-foreground">{rest.join(" · ")}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                    <a href={gcalUrl(session)} target="_blank" rel="noopener noreferrer" aria-label="Add to Google Calendar">
                      <CalendarPlus size={16} />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add to Google Calendar</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => downloadIcs(session)}
                    aria-label="Download .ics"
                  >
                    <Download size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download .ics</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>

      {attendanceOpen ? (
        <Button size="lg" className="group w-full" onClick={() => router.push("/infosession/attend")}>
          Submit attendance
          <ArrowRight size={15} className="ml-1.5 transition-transform group-hover:translate-x-0.5" />
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Wrapper div is the trigger: the disabled button emits no pointer events. */}
            <div className="w-full">
              <Button size="lg" className="w-full" disabled>
                Submit attendance
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">Available at infosession time</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
