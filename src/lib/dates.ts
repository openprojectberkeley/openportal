// Local-time calendar arithmetic, shared by the calendar page, the mini panel,
// and (eventually) the coffee-chat grid.
//
// A facade over event-days.ts rather than a replacement: dayKey/dayKeysFor own
// the `end_time`-INCLUSIVE contract and carry their own tests, so they stay put
// and are re-exported here so new code needs one import.
export { dayKey, dayKeysFor, type DaySpan } from "@/lib/event-days";

import { dayKey } from "@/lib/event-days";

/**
 * 0 = Sunday, 1 = Monday. Sunday matches the mini panel's existing WEEKDAYS
 * header, so the full calendar's week view is literally one row of its month
 * grid blown up. Flip this one constant for a Monday-first calendar.
 */
export const WEEK_STARTS_ON = 0 as 0 | 1;

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Sunday-indexed, so `WEEKDAYS_SHORT[d.getDay()]` is always correct. */
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Column headers for a 7-wide grid, rotated to the configured week start. */
export function weekdayLabels(weekStartsOn: 0 | 1 = WEEK_STARTS_ON): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS_SHORT[(i + weekStartsOn) % 7]);
}

/** Local midnight of `d`'s day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * `n` days after `d`, at the same wall-clock time.
 *
 * Built from the y/m/d parts rather than `+ n * 86400000` so a DST boundary
 * shifts by one calendar day, not by 23 or 25 hours.
 */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** Local midnight of the first day of `d`'s week. */
export function startOfWeek(d: Date, weekStartsOn: 0 | 1 = WEEK_STARTS_ON): Date {
  const start = startOfDay(d);
  const back = (start.getDay() - weekStartsOn + 7) % 7;
  return addDays(start, -back);
}

/** startOfWeek(d, 1) — the name the coffee-chat grid uses for the same thing. */
export function mondayOf(d: Date): Date {
  return startOfWeek(d, 1);
}

/**
 * Parse a "YYYY-MM-DD" key as LOCAL midnight, or null if it isn't one.
 *
 * Returns null rather than an Invalid Date because the caller is usually a URL
 * param: `new Date(NaN, ...)` propagating into monthMatrix() renders 42 "NaN"
 * cells instead of falling back to today.
 */
export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, day);
  // Rejects 2026-02-31, which Date would roll forward to March 3.
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  return d;
}

/** Value for an `<input type="date">`. Same string as dayKey. */
export function toDateInputValue(d: Date): string {
  return dayKey(d);
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * The 42 local-midnight days a month view shows: the month, plus the spill days
 * that fill its first and last weeks.
 *
 * Always 42 — six rows — so the grid's height never changes between months.
 */
export function monthMatrix(year: number, month: number, weekStartsOn: 0 | 1 = WEEK_STARTS_ON): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The 7 local-midnight days of `d`'s week. */
export function weekDays(d: Date, weekStartsOn: 0 | 1 = WEEK_STARTS_ON): Date[] {
  const start = startOfWeek(d, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Hour-gutter label: "9am", "12pm", "11pm". */
export function formatHour(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${suffix}`;
}

/** "6:00 PM" — the long form, for cards and detail rails. */
export function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Mon, Sep 28" — the long form, for cards and detail rails. */
export function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/**
 * "6p", "6:30p" — the shortest honest time, for the 11px month chips and week
 * blocks where the long form would push the title out of view.
 */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const min = d.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

/**
 * Local Date for a "YYYY-MM-DD" day key, for formatting a heading from it.
 *
 * The "T00:00" suffix is load-bearing: `new Date("2026-10-06")` parses as UTC
 * midnight, which prints as October 5 for any viewer west of Greenwich.
 */
export function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00`);
}
