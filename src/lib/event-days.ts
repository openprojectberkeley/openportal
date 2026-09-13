// Which local calendar days an event occupies.
//
// Split out of calendar-panel so it can be unit-tested: a multi-day event (the
// club retreat spans two days) must appear on every day it covers, not just its
// start date, which is what the panel's day-bucketing used to do.

/** Local YYYY-MM-DD key for a Date. Must match the calendar panel's bucketing. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// A guard, so a corrupt or absurd end date can't spin the loop.
const MAX_EVENT_DAYS = 60;

export type DaySpan = { start_time: string; end_time: string | null };

/**
 * Every local day key from an event's start through its end, inclusive.
 *
 * `end_time` is stored INCLUSIVE (the Google sync pulls exclusive all-day
 * DTENDs back by one day), so a Sep 26–27 retreat yields exactly two keys.
 */
export function dayKeysFor(ev: DaySpan): string[] {
  const start = new Date(ev.start_time);
  if (Number.isNaN(start.getTime())) return [];

  const keys = [dayKey(start)];
  if (!ev.end_time) return keys;

  const end = new Date(ev.end_time);
  if (Number.isNaN(end.getTime()) || end <= start) return keys;

  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = dayKey(end);
  for (let i = 0; i < MAX_EVENT_DAYS && keys[keys.length - 1] !== last; i++) {
    cursor.setDate(cursor.getDate() + 1);
    keys.push(dayKey(cursor));
  }
  return keys;
}
