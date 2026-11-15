"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { dayKey, formatEventTime, formatHour, shortTime, WEEKDAYS_SHORT } from "@/lib/dates";
import { eventBarColor } from "@/lib/event-tint";
import { isBandEvent, layoutDay } from "@/lib/week-layout";
import { cn } from "@/lib/utils";
import type { PortalEvent } from "@/lib/use-calendar-events";

const HOUR_PX = 48; // one h-12 row per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i); // full day, so a 23:00 event can't vanish
const DAY_PX = 24 * HOUR_PX;
const MIN_BLOCK_PX = 18; // a 15-minute coffee chat is still clickable
const SCROLL_TO_HOUR = 8;
/** One constant for all three rows, or their columns drift apart. */
const GUTTER = "w-14";
/** Re-tick the now-line each minute, like the notification poll. */
const NOW_TICK_MS = 60_000;

type Props = {
  /** The 7 days of the displayed week. */
  days: Date[];
  eventsByDay: Map<string, PortalEvent[]>;
  selectedKey: string;
  todayKey: string;
  resolve: (ev: PortalEvent) => { name: string | null; color: string | null };
  onSelectDay: (key: string) => void;
  /** `key` is the column the block sits in, which may not be the event's start day. */
  onOpenEvent: (ev: PortalEvent, key: string) => void;
};

export function CalendarWeekGrid({
  days,
  eventsByDay,
  selectedKey,
  todayKey,
  resolve,
  onSelectDay,
  onOpenEvent,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Empty deps on purpose: the grid scrolls to the morning once, and then
  // navigating weeks preserves wherever the user left it — what calendars do.
  // "instant" means nothing animates, so there's no reduced-motion concern.
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: SCROLL_TO_HOUR * HOUR_PX, behavior: "instant" });
  }, []);

  // Set after mount so the server and the first client render agree.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const nowTopPx = now ? ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX : null;

  return (
    <div className="flex flex-col">
      {/* Day header, outside the scroll area so it stays put. */}
      <div className="flex overflow-hidden rounded-t-xl border-x border-t">
        <div className={cn(GUTTER, "shrink-0 border-r")} />
        {days.map((d) => {
          const key = dayKey(d);
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(key)}
              aria-label={d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 border-r py-2 transition-colors last:border-r-0 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                key === selectedKey && "bg-accent/60",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {WEEKDAYS_SHORT[d.getDay()]}
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums",
                  isToday && "bg-foreground font-semibold text-background",
                )}
              >
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day band. Multi-day timed events live here too — a two-day retreat
          as a 48h-tall block would blow its column — and dayKeysFor already
          gives exactly the days to repeat its chip on. */}
      <div className="flex border-x border-b bg-muted/30">
        <div className={cn(GUTTER, "shrink-0 border-r py-1 pr-1.5 text-right text-[10px] text-muted-foreground")}>
          all-day
        </div>
        {days.map((d) => {
          const key = dayKey(d);
          const band = (eventsByDay.get(key) ?? []).filter(isBandEvent);
          return (
            <div
              key={key}
              className="flex min-h-7 min-w-0 flex-1 flex-col gap-0.5 border-r p-0.5 last:border-r-0"
            >
              {band.map((ev) => {
                const { color } = resolve(ev);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onOpenEvent(ev, key)}
                    title={ev.title}
                    // No fill: bar + title, like every event.
                    className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-medium leading-tight transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden
                      className="h-3 w-[2px] shrink-0 rounded-full"
                      style={{ backgroundColor: eventBarColor(ev.category, color) }}
                    />
                    <span className="min-w-0 truncate">{ev.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Hour grid. min-w keeps each column readable; the scroll area handles
          the overflow at phone width. */}
      <ScrollArea
        ref={viewportRef}
        className="max-h-[68vh] rounded-b-xl border-x border-b"
        orientation="both"
      >
        <div className="flex min-w-[44rem]">
          <div className={cn(GUTTER, "shrink-0 border-r")}>
            {HOURS.map((h) => (
              <div key={h} className="h-12 pr-1.5 text-right">
                {/* Midnight's label would sit above the grid, so it's dropped. */}
                <span className="inline-block -translate-y-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {h === 0 ? "" : formatHour(h)}
                </span>
              </div>
            ))}
          </div>

          {days.map((d) => {
            const key = dayKey(d);
            const timed = (eventsByDay.get(key) ?? []).filter((ev) => !isBandEvent(ev));
            return (
              <div
                key={key}
                className="relative min-w-0 flex-1 border-r last:border-r-0"
                style={{ height: DAY_PX }}
              >
                {HOURS.map((h) => (
                  <div key={h} className="h-12 border-b border-border/40" />
                ))}

                {layoutDay(timed, d, HOUR_PX, MIN_BLOCK_PX).map(({ ev, topPx, heightPx, lane, lanes }) => {
                  const { color } = resolve(ev);
                  const bar = eventBarColor(ev.category, color);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onOpenEvent(ev, key)}
                      title={`${ev.title} — ${formatEventTime(ev.start_time)}`}
                      style={{
                        top: topPx,
                        height: heightPx,
                        left: `${(lane / lanes) * 100}%`,
                        // A 2px gap between lanes instead of a border.
                        width: `calc(${100 / lanes}% - 2px)`,
                        // Keeps a faint tint of the time span (hour lines show
                        // through); the identity is the bar on the left.
                        backgroundColor: `color-mix(in srgb, ${bar} 14%, transparent)`,
                      }}
                      // focus-visible:z-20 so a focused block in a narrow lane
                      // isn't occluded by its neighbour.
                      className="absolute z-10 overflow-hidden rounded py-0.5 pl-2 pr-1 text-left text-[11px] leading-tight transition-colors hover:brightness-110 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span aria-hidden className="absolute bottom-0.5 left-0.5 top-0.5 w-[3px] rounded-full" style={{ backgroundColor: bar }} />
                      <span className="block truncate font-medium">{ev.title}</span>
                      <span className="block truncate opacity-70">{shortTime(ev.start_time)}</span>
                    </button>
                  );
                })}

                {key === todayKey && nowTopPx !== null && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-20 h-px bg-destructive"
                    style={{ top: nowTopPx }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
