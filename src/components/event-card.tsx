"use client";

import { MapPin, MoreHorizontal, Pencil, Trash2, CalendarPlus, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

    {/* Every action lives in one ⋯ menu at the bottom right, shown on
        hover/focus; it takes no layout space. */}
      {actions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Options for ${ev.title}`}
              className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/event:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[11rem]" onClick={(e) => e.stopPropagation()}>
            {ev.external_link && (
              <DropdownMenuItem asChild>
                <a href={ev.external_link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} className="mr-2" /> Open in Google Calendar
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => downloadEventIcs(ev)}>
              <CalendarPlus size={14} className="mr-2" /> Add to calendar (.ics)
            </DropdownMenuItem>
            {onEdit && (
              // Next frame: the menu finishes closing before the edit dialog opens.
              <DropdownMenuItem onSelect={() => requestAnimationFrame(onEdit)}>
                <Pencil size={14} className="mr-2" /> Edit
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={deleting}
                  onSelect={() => requestAnimationFrame(onDelete)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 size={14} className="mr-2" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
