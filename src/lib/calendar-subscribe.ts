// Subscribe links for a PUBLIC Google Calendar.
//
// Separate from google-calendar-feed.ts (server-side reading, needs an API key)
// and from ics.ts (building a one-off .ics for a single event). These are plain
// URLs the browser hands to a calendar app — no key, no fetch, nothing to
// authorize, because the calendar is publicly shared.

const GOOGLE_RENDER = "https://calendar.google.com/calendar/render";
const ICAL_HOST = "calendar.google.com";

function icalPath(calendarId: string): string {
  // The id contains an "@", which must be percent-encoded inside a path segment.
  return `/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
}

/** Google's "add this calendar?" prompt. One click for anyone on a Google account. */
export function googleSubscribeUrl(calendarId: string): string {
  return `${GOOGLE_RENDER}?cid=${encodeURIComponent(calendarId)}`;
}

/**
 * Subscription URL for Apple Calendar, Outlook, Fantastical and Google's
 * "From URL" field.
 *
 * `webcal://` rather than `https://` is deliberate. The two resolve to the same
 * file, but a copied https link that someone *clicks* downloads a one-time
 * snapshot — it looks like it worked and then never updates again. The webcal
 * scheme opens the calendar app in subscribe mode instead, so the events keep
 * following the Google calendar.
 */
export function icsSubscribeUrl(calendarId: string): string {
  return `webcal://${ICAL_HOST}${icalPath(calendarId)}`;
}

/** The same feed over https — what a fetch or a manual check would use. */
export function icsHttpsUrl(calendarId: string): string {
  return `https://${ICAL_HOST}${icalPath(calendarId)}`;
}

/**
 * The club calendar id as the browser sees it, or null when unconfigured (in
 * which case callers hide the subscribe UI rather than render a dead link).
 * Must be read as a full literal member expression — Next inlines
 * `process.env.NEXT_PUBLIC_*` at build time and can't substitute a dynamic key.
 */
export function publicCalendarId(): string | null {
  return process.env.NEXT_PUBLIC_OPEN_PROJECT_CALENDAR_ID || null;
}
