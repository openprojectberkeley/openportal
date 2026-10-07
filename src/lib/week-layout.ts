// Geometry for the week view's hour grid: which events belong in the all-day
// band, and where the rest sit in their day's column.
//
// Pure and generic over the event shape (no component imports) so it runs in
// vitest's node environment — this is the one genuinely fiddly part of the week
// view, so it's the part that gets tested.

import { dayKeysFor } from "@/lib/event-days";
import { startOfDay } from "@/lib/dates";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The minimum an event needs for layout: a start, and maybe an end. */
export type TimedEvent = { start_time: string; end_time: string | null };

export type TimedBlock<T> = {
  ev: T;
  topPx: number;
  heightPx: number;
  /** 0-based column within its overlap cluster. */
  lane: number;
  /** How many columns that cluster needs — so width is 100/lanes percent. */
  lanes: number;
};

/**
 * All-day events, and any event spanning more than one day, go in the band.
 *
 * A two-day retreat rendered as a 48h-tall block would blow its column, and
 * dayKeysFor already tells us exactly which days to repeat its chip on.
 */
export function isBandEvent(ev: TimedEvent & { all_day: boolean }): boolean {
  return ev.all_day || dayKeysFor(ev).length > 1;
}

/**
 * Position one day's timed events.
 *
 * Clamps each block to [dayStart, dayEnd), which is what makes an event
 * crossing midnight render as two blocks — one in each day dayKeysFor() put it
 * in — instead of one block overflowing its column.
 *
 * Lanes are packed per CLUSTER of mutually-overlapping events, not per day: one
 * 2-way collision at 9am must not halve the width of every other block that
 * day.
 */
export function layoutDay<T extends TimedEvent>(
  events: readonly T[],
  day: Date,
  hourPx: number,
  minPx: number,
): TimedBlock<T>[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;

  const spans = events
    .map((ev) => {
      const rawStart = new Date(ev.start_time).getTime();
      if (Number.isNaN(rawStart)) return null;
      // No end_time -> assume an hour, so the block has a clickable height.
      const rawEnd = ev.end_time ? new Date(ev.end_time).getTime() : rawStart + HOUR_MS;
      const s = Math.max(rawStart, dayStart);
      // At least a minute long, and never past midnight.
      const e = Math.max(Math.min(Number.isNaN(rawEnd) ? s + HOUR_MS : rawEnd, dayEnd), s + 60_000);
      return { ev, s, e };
    })
    .filter((x): x is { ev: T; s: number; e: number } => x !== null)
    // Longest-first on a tie, so the enclosing event takes the left lane.
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const blocks: TimedBlock<T>[] = [];

  // Sweep into clusters: a new cluster starts at the first span that begins
  // at or after every end seen so far, i.e. where the overlap chain breaks.
  let cluster: { ev: T; s: number; e: number; lane: number }[] = [];
  let clusterEnd = -Infinity;
  /** Last end time per lane, reset with each cluster. */
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const item of cluster) {
      const topPx = ((item.s - dayStart) / HOUR_MS) * hourPx;
      const heightPx = Math.max(((item.e - item.s) / HOUR_MS) * hourPx, minPx);
      blocks.push({ ev: item.ev, topPx, heightPx, lane: item.lane, lanes });
    }
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const span of spans) {
    if (span.s >= clusterEnd && cluster.length > 0) flush();
    // First lane whose last event has already ended, else a new lane.
    let lane = laneEnds.findIndex((end) => end <= span.s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(span.e);
    } else {
      laneEnds[lane] = span.e;
    }
    cluster.push({ ...span, lane });
    clusterEnd = Math.max(clusterEnd, span.e);
  }
  if (cluster.length > 0) flush();

  return blocks;
}
