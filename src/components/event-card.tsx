"use client";

import { MapPin, Pencil, Trash2, CalendarPlus, ExternalLink } from "lucide-react";
import { CATEGORY_META, isRoleGated } from "@/lib/event-category";
import { eventBarColor, eventTintColor } from "@/lib/event-tint";
import { readableAccentText } from "@/lib/portal-color";
import { formatEventDate, formatEventTime } from "@/lib/dates";
import { downloadEventIcs } from "@/lib/ics";
import { cn } from "@/lib/utils";
import type { PortalEvent } from "@/lib/use-calendar-events";

/**
 * One event: no card, no outline, just the information beside a rounded
 * colour bar (its category's colour, or its portal's for general events),
 * with the category and portal labels in readable versions of their colours.
 * Shared by the mini calendar panel, the calendar page's day rail and the
 * agenda view, so an event reads the same wherever it appears. `id` lets the
 * calendar scroll to it (#event-<id>).
 */
export function EventCard({
  ev,
  name,
  color,
  showDate = false,
  onEdit,
  onDelete,
  deleting = false,
  onClick,
  actions = true,
}: {
  ev: PortalEvent;
  name: string | null;
  color: string | null;
  showDate?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  onClick?: () => void;
  actions?: boolean;
}) {
  const bar = eventBarColor(ev.category, color);
  const portalTint = color ?? eventTintColor(ev.category, color);
  return (
    <div
      id={`event-${ev.id}`}
      className={cn(
        "group/event relative flex scroll-mt-24 flex-col gap-1 rounded-md py-1.5 pl-4 pr-2.5",
        onClick && "cursor-pointer",
      )}
      onClick={onClick}
    >
      <span aria-hidden className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full" style={{ backgroundColor: bar }} />
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-sm font-medium">{ev.title}</span>
          <span className="text-xs text-muted-foreground">
            {showDate && `${formatEventDate(ev.start_time)} · `}
            {ev.all_day
              ? "All day"
              : `${formatEventTime(ev.start_time)}${ev.end_time ? ` – ${formatEventTime(ev.end_time)}` : ""}`}
          </span>
          {ev.location && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground min-w-0" title={ev.location}>
              <MapPin size={11} className="flex-shrink-0" /> <span className="truncate">{ev.location}</span>
            </span>
          )}
          {ev.description && <span className="text-xs text-muted-foreground">{ev.description}</span>}
        </div>
        <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
          {ev.category !== "general" && (
            <span
              className="text-[10px] font-medium whitespace-nowrap"
              style={{ color: readableAccentText(CATEGORY_META[ev.category].color) }}
              title={isRoleGated(ev.category) ? "Visible to board and exec only" : undefined}
            >
              {CATEGORY_META[ev.category].label}
              {isRoleGated(ev.category) && " · board only"}
            </span>
          )}
          {name && (
            <span
              className="text-[10px] font-medium whitespace-nowrap max-w-[8rem] truncate"
              style={portalTint ? { color: readableAccentText(portalTint) } : undefined}
              title={name}
            >
              {name}
            </span>
          )}
        </span>
      </div>

      {/* Controls overlay the bottom-right on hover — no layout space taken. A
          gradient in the card's own colour washes out the content beneath. */}
      {actions && (
        <div
          className="absolute inset-0 flex items-end justify-end p-1.5 opacity-0 group-hover/event:opacity-100 focus-within:opacity-100 transition-opacity pointer-events-none"
          style={{ background: "linear-gradient(to top left, hsl(var(--background)) 0%, hsl(var(--background)) 22%, transparent 60%)" }}
        >
          <div className="flex items-center gap-0.5 pointer-events-auto">
            {ev.external_link && (
              <a
                href={ev.external_link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                aria-label={`Open ${ev.title} in Google Calendar`}
                title="Open in Google Calendar"
              >
                <ExternalLink size={13} />
              </a>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); downloadEventIcs(ev); }}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
              aria-label={`Add ${ev.title} to calendar`}
            >
              <CalendarPlus size={13} />
            </button>
            {onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                aria-label={`Edit ${ev.title}`}
              >
                <Pencil size={13} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                disabled={deleting}
                className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded disabled:opacity-40"
                aria-label={`Delete ${ev.title}`}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
