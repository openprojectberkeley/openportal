"use client";

import { useState } from "react";
import { CalendarPlus, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { googleSubscribeUrl, icsSubscribeUrl, publicCalendarId } from "@/lib/calendar-subscribe";
import { cn } from "@/lib/utils";

/**
 * Subscribe to the club's public calendar feed.
 *
 * Portal calendars don't get one: they mirror the club feed's events, but
 * subscribing is a decision about the whole club's schedule, so it belongs in
 * the places that are about exactly that — the dashboard's calendar card (which
 * passes `className="mb-3 w-full"` to fill it) and the /calendar toolbar.
 */
export function SubscribeMenu({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const calendarId = publicCalendarId();

  // No calendar configured — hide the control rather than render a dead link.
  if (!calendarId) return null;

  const copyIcs = async () => {
    try {
      await navigator.clipboard.writeText(icsSubscribeUrl(calendarId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (non-secure context) — nothing to do.
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            className,
          )}
        >
          <CalendarPlus size={14} /> Subscribe
          <ChevronDown size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem asChild>
          <a href={googleSubscribeUrl(calendarId)} target="_blank" rel="noopener noreferrer">
            Add to Google Calendar
          </a>
        </DropdownMenuItem>
        {/* Keeps the menu open so the "Copied!" confirmation is actually seen. */}
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); copyIcs(); }}>
          {copied ? <><Check size={14} /> Copied!</> : "Copy iCal link"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
