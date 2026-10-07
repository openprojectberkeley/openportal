"use client";

import { dayKey, formatEventTime, shortTime, weekdayLabels } from "@/lib/dates";
import { eventSurface } from "@/lib/event-tint";
import { cn } from "@/lib/utils";
import type { PortalEvent } from "@/lib/use-calendar-events";

/** Chips a cell shows before collapsing the rest into "+N more". */
const CHIP_CAP = 3;

type Props = {
  /** The 42 days from monthMatrix() — six rows, so the height never changes. */
  cells: Date[];
  /** The month being displayed; cells outside it render as muted spill days. */
  month: number;
  eventsByDay: Map<string, PortalEvent[]>;
  selectedKey: string;
  todayKey: string;
  resolve: (ev: PortalEvent) => { name: string | null; color: string | null };
  onSelectDay: (key: string) => void;
  /** `key` is the cell the chip sits in, which may not be the event's start day. */
  onOpenEvent: (ev: PortalEvent, key: string) => void;
};

export function CalendarMonthGrid({
  cells,
  month,
  eventsByDay,
  selectedKey,
  todayKey,
  resolve,
  onSelectDay,
  onOpenEvent,
}: Props) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 overflow-hidden rounded-t-xl border-x border-t">
        {weekdayLabels().map((w) => (
          <div
            key={w}
            className="select-none border-b px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-b-xl border-l bg-background">
        {cells.map((d) => {
          const key = dayKey(d);
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = d.getMonth() === month;
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const shown = dayEvents.slice(0, CHIP_CAP);
          const overflow = dayEvents.length - shown.length;

          return (
            <div
              key={key}
              className={cn(
                "relative flex min-h-[6.5rem] flex-col gap-1 border-b border-r p-1 sm:min-h-[7.5rem] sm:p-1.5",
                inMonth ? "bg-background" : "bg-muted/40",
                isSelected && "ring-1 ring-inset ring-foreground",
              )}
            >
              {/* A button can't contain the clickable chips, so the full-cell
                  select target sits underneath them — the same overlay trick
                  the portal cards use for their whole-card link. */}
              <button
                type="button"
                onClick={() => onSelectDay(key)}
                aria-label={`${d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                className="absolute inset-0 z-0 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              />

              <span
                className={cn(
                  "pointer-events-none relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
                  isToday && "bg-foreground font-semibold text-background",
                  !isToday && !inMonth && "text-muted-foreground/60",
                )}
              >
                {d.getDate()}
              </span>

              <span className="relative z-10 flex min-w-0 flex-col gap-0.5">
                {shown.map((ev) => {
                  const { color } = resolve(ev);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onOpenEvent(ev, key)}
                      // The chip is too small for the full title, let alone the
                      // time, so the tooltip carries both.
                      title={`${ev.title} — ${ev.all_day ? "All day" : formatEventTime(ev.start_time)}`}
                      // Text stays currentColor: eventSurface mixes toward the
                      // theme background, so the foreground reads in both themes.
                      style={{ backgroundColor: eventSurface(ev.category, color, 24) }}
                      className="flex w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{ev.title}</span>
                      {!ev.all_day && (
                        <span className="hidden shrink-0 tabular-nums opacity-70 sm:inline">
                          {shortTime(ev.start_time)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  // Just selects the day — the detail rail below already lists
                  // every one of them, so there's no popover to build.
                  <button
                    type="button"
                    onClick={() => onSelectDay(key)}
                    className="px-1 text-left text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    +{overflow} more
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
