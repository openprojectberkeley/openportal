// Server-side reader for a PUBLIC Google Calendar, via the Calendar API v3.
//
// Deliberately separate from src/lib/google-calendar.ts: that one runs in the
// browser, uses a short-lived GIS user token for free/busy only, and persists
// nothing. This one runs only on the server, reads full event details from a
// calendar that is publicly shared, and authenticates with an API key. Keeping
// them apart keeps each file's trust model obvious.
//
// `singleEvents=true` is the crux. The club's 10 weekly GMs are stored in
// Google as only 2 recurring series plus 8 per-instance overrides; with this
// flag Google expands them and returns each occurrence separately, each with a
// stable per-instance id (`<seriesId>_<utcStart>`). That id is what the sync
// keys rows on, so attendance taken against "GM #4" survives every re-sync.
// Expanding RRULE/EXDATE/RECURRENCE-ID by hand would be the alternative.
//
// Requires GOOGLE_CALENDAR_API_KEY (server-only; restrict it to the Calendar
// API in Google Cloud) and NEXT_PUBLIC_OPEN_PROJECT_CALENDAR_ID.

const ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";

// Google caps page size at 2500; 250 keeps each response small.
const PAGE_SIZE = 250;

export type NormalizedEvent = {
  external_id: string;
  external_etag: string | null;
  external_link: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;      // ISO
  end_time: string | null; // ISO
  all_day: boolean;
  cancelled: boolean;
};

type GoogleEvent = {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'",
};

/**
 * Google event descriptions are HTML — the club's board-meeting entry contains
 * `<br>` and a full `<a href>` Zoom link. The calendar's EventCard renders the
 * description as plain text, so markup would show up verbatim. Flatten it to
 * text, keeping the line structure and the link targets (which carry the Zoom
 * URL members actually need).
 */
export function htmlToText(html: string): string {
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    // Keep the href when the anchor text is just the URL again or is empty,
    // otherwise render "text (url)" so the destination is never lost.
    .replace(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, text: string) => {
        const label = text.replace(/<[^>]*>/g, "").trim();
        if (!label || label === href) return href;
        return `${label} (${href})`;
      },
    )
    .replace(/<[^>]*>/g, "")
    .replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (m, e: string) => {
      const key = e.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      const num = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : /^#/.test(key) ? parseInt(key.slice(1), 10) : NaN;
      return Number.isFinite(num) ? String.fromCodePoint(num) : m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * An all-day event arrives as `start.date` (a floating YYYY-MM-DD) instead of
 * `start.dateTime`. Store it as local midnight, matching how the event form
 * writes all-day events (`new Date(\`${date}T00:00\`)`).
 */
function parseAllDay(date: string): string {
  return new Date(`${date}T00:00`).toISOString();
}

function normalize(ev: GoogleEvent): NormalizedEvent | null {
  if (!ev.id) return null;

  const allDay = Boolean(ev.start?.date);
  const startRaw = ev.start?.dateTime ?? ev.start?.date;
  // A cancelled instance of a recurring series can come back with no start at
  // all; we still want the row marked cancelled, so fall through on `cancelled`
  // and only bail when there's genuinely nothing to write.
  if (!startRaw) return null;

  const endRaw = ev.end?.dateTime ?? ev.end?.date;
  let end: string | null = null;
  if (endRaw) {
    if (allDay) {
      // All-day DTEND is EXCLUSIVE in both iCalendar and the Google API: a
      // one-day event ends on the following date. Pull it back a day so the
      // calendar's day-span bucketing doesn't paint an extra day.
      const d = new Date(`${endRaw}T00:00`);
      d.setDate(d.getDate() - 1);
      end = d.toISOString();
    } else {
      end = new Date(endRaw).toISOString();
    }
  }

  const description = ev.description ? htmlToText(ev.description) : "";

  return {
    external_id: ev.id,
    external_etag: ev.etag ?? null,
    external_link: ev.htmlLink ?? null,
    title: (ev.summary ?? "").trim() || "(untitled)",
    description: description || null,
    location: ev.location?.trim() || null,
    start_time: allDay ? parseAllDay(startRaw) : new Date(startRaw).toISOString(),
    end_time: end,
    all_day: allDay,
    cancelled: ev.status === "cancelled",
  };
}

export class GoogleCalendarError extends Error {}

/**
 * Every occurrence in [timeMin, timeMax), recurrences already expanded.
 * `showDeleted` is on so instances cancelled in Google come back with
 * `status: "cancelled"` and the sync can soft-cancel the matching row rather
 * than leaving a ghost event on the calendar.
 */
export async function fetchCalendarEvents(
  calendarId: string,
  opts: { timeMin: Date; timeMax: Date; apiKey: string },
): Promise<NormalizedEvent[]> {
  const out: NormalizedEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${ENDPOINT}/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("key", opts.apiKey);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    url.searchParams.set("timeMin", opts.timeMin.toISOString());
    url.searchParams.set("timeMax", opts.timeMax.toISOString());
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 404 here almost always means the calendar isn't shared publicly, which
      // is worth saying outright — the key and the id both look fine.
      const hint =
        res.status === 404
          ? " (is the calendar shared as 'Make available to public'?)"
          : res.status === 403
            ? " (is the API key restricted to the Calendar API and is that API enabled?)"
            : "";
      throw new GoogleCalendarError(
        `Google Calendar request failed (${res.status})${hint}: ${body.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    for (const item of data.items ?? []) {
      const ev = normalize(item);
      if (ev) out.push(ev);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return out;
}

/** Reads + validates the two env vars the sync needs. */
export function calendarConfig(): { calendarId: string; apiKey: string } {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  // NEXT_PUBLIC_ is the canonical name — the dashboard's Subscribe button builds
  // its links in the browser and needs the same id. A public calendar id is not
  // a secret (it's in the .ics URL anyone can fetch). The unprefixed name is
  // still honored so an environment configured before the rename keeps working.
  const calendarId =
    process.env.NEXT_PUBLIC_OPEN_PROJECT_CALENDAR_ID ?? process.env.OPEN_PROJECT_CALENDAR_ID;
  if (!apiKey) throw new GoogleCalendarError("GOOGLE_CALENDAR_API_KEY is not set.");
  if (!calendarId) {
    throw new GoogleCalendarError("NEXT_PUBLIC_OPEN_PROJECT_CALENDAR_ID is not set.");
  }
  return { calendarId, apiKey };
}
