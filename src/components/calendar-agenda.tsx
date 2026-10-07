"use client";

import { useMemo } from "react";
import { EventCard } from "@/components/event-card";
import { addDays, dayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { PortalEvent } from "@/lib/use-calendar-events";

type Props = {
  eventsByDay: Map<string, PortalEvent[]>;
  /** First day of the window — a local midnight, never mount time. */
  from: Date;
  /** How many days forward the window runs. */
  days?: number;
  todayKey: string;
  resolve: (ev: PortalEvent) => { name: string | null; color: string | null };
  canManageEvent: (ev: PortalEvent) => boolean;
  onEdit: (ev: PortalEvent) => void;
  onDelete: (ev: PortalEvent) => void;
  deletingId: string | null;
};

export function CalendarAgenda({
  eventsByDay,
  from,
  days = 60,
  todayKey,
  resolve,
  canManageEvent,
  onEdit,
  onDelete,
  deletingId,
}: Props) {
  // Built by walking day keys, not by filtering on start_time: a retreat that
  // began yesterday and runs through tomorrow must still show up today, and
  // eventsByDay already has it on every day it covers.
  const groups = useMemo(() => {
    const out: { key: string; date: Date; events: PortalEvent[] }[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      const key = dayKey(date);
      const dayEvents = eventsByDay.get(key) ?? [];
      // Skip empty days rather than printing 60 "no events" rows.
      if (dayEvents.length === 0) continue;
      out.push({
        key,
        date,
        events: [...dayEvents].sort(
          (a, b) =>
            Number(b.all_day) - Number(a.all_day) ||
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
        ),
      });
    }
    return out;
  }, [eventsByDay, from, days]);

  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nothing scheduled in the next {days} days.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ key, date, events }) => {
        const isToday = key === todayKey;
        return (
          <div key={key} className="flex gap-3 sm:gap-4">
            <div className="w-14 shrink-0 pt-0.5 text-center sm:w-20">
              <div
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-wide",
                  isToday ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {isToday ? "Today" : date.toLocaleDateString([], { weekday: "short" })}
              </div>
              <div className="text-2xl font-bold leading-none tabular-nums">{date.getDate()}</div>
              <div className="text-[11px] text-muted-foreground">
                {date.toLocaleDateString([], { month: "short" })}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 border-l pl-3 sm:pl-4">
              {events.map((ev) => {
                const { name, color } = resolve(ev);
                const manage = canManageEvent(ev);
                return (
                  <EventCard
                    key={ev.id}
                    ev={ev}
                    name={name}
                    color={color}
                    onEdit={manage ? () => onEdit(ev) : undefined}
                    // A synced row just resurrects on the next sync, minus its
                    // attendance — remove it in Google instead.
                    onDelete={manage && !ev.external_source ? () => onDelete(ev) : undefined}
                    deleting={deletingId === ev.id}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
