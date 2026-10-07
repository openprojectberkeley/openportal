"use client";

import { MapPin, Pencil, Trash2, CalendarPlus, ExternalLink } from "lucide-react";
import { CATEGORY_META, isRoleGated } from "@/lib/event-category";
import { eventSurface } from "@/lib/event-tint";
import { formatEventDate, formatEventTime } from "@/lib/dates";
import { downloadEventIcs } from "@/lib/ics";
import { cn } from "@/lib/utils";
import type { PortalEvent } from "@/lib/use-calendar-events";

/**
 * One event, tinted with its category's (or its portal's) accent — whole-card,
 * not a badge. Shared by the mini calendar panel, the calendar page's day rail
 * and the agenda view, so an event reads the same wherever it appears.
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
  // Opaque card color, reused for the hover overlay's gradient so it washes out
  // the content beneath the buttons in the card's own colour.
  const cardBg = eventSurface(ev.category, color, 18);
  return (
    <div
      className={cn(
        "group/event relative overflow-hidden rounded-md px-2.5 py-2 flex flex-col gap-1",
        onClick && "cursor-pointer",
      )}
      style={{ backgroundColor: cardBg }}
      onClick={onClick}
    >
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
              style={{ color: CATEGORY_META[ev.category].color }}
              title={isRoleGated(ev.category) ? "Visible to board and exec only" : undefined}
            >
              {CATEGORY_META[ev.category].label}
              {isRoleGated(ev.category) && " · board only"}
            </span>
          )}
          {name && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap max-w-[8rem] truncate" title={name}>
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
          style={{ background: `linear-gradient(to top left, ${cardBg} 0%, ${cardBg} 22%, transparent 60%)` }}
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
                className="text-muted-foreground hover:text-red-500 transition-colors p-1 rounded disabled:opacity-40"
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
