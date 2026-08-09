// Client-side Google Calendar free/busy helper.
//
// This is deliberately independent of the app's Supabase Google login (which
// only requests identity scopes). It uses Google Identity Services (GIS) to
// obtain a short-lived access token for two read-only scopes:
//   - `calendar.freebusy`             — query busy blocks
//   - `calendar.calendarlist.readonly` — list which calendars the user has
// then queries the CalendarList + FreeBusy REST endpoints (both support browser
// CORS) directly. This lets us include *every* calendar the user can read
// free/busy for, not just their primary. Neither scope exposes event titles or
// details — only calendar names and busy time ranges. Nothing is persisted: the
// token lives only for the duration of a single sync, and no refresh token or
// client secret is involved.
//
// Requires the GIS script (https://accounts.google.com/gsi/client) to be loaded
// on the page and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to be set.

// GIS takes scopes as a single space-delimited string.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");
const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const CALENDAR_LIST_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

// The FreeBusy endpoint accepts at most 50 calendars per request.
const MAX_CALENDARS_PER_REQUEST = 50;

// Minimal ambient typing for the slice of GIS we use — we don't pull in
// @types/google.accounts just for this.
type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
  callback: (resp: TokenResponse) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

export type BusyInterval = { start: Date; end: Date };

/**
 * Opens the Google consent popup and resolves with a short-lived access token
 * scoped to `calendar.freebusy` + `calendar.calendarlist.readonly`. Rejects if
 * the user denies/closes the popup, the popup is blocked, or the GIS script /
 * client id is unavailable.
 */
export function requestFreeBusyToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Promise.reject(new Error("Google Calendar is not configured."));
  }
  const gis = typeof window !== "undefined" ? window.google : undefined;
  if (!gis) {
    return Promise.reject(
      new Error("Google sign-in failed to load. Check your connection and try again."),
    );
  }

  return new Promise<string>((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || "Google Calendar access was denied."));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || "Google Calendar access was cancelled."));
      },
    });
    client.requestAccessToken();
  });
}

/**
 * Lists the IDs of every calendar the caller can read free/busy for (their
 * primary plus any secondary, shared, or subscribed calendars). Paginates in
 * case the account has many calendars.
 */
async function fetchCalendarIds(token: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(CALENDAR_LIST_ENDPOINT);
    // freeBusyReader is the lowest access role — enough to query busy times.
    url.searchParams.set("minAccessRole", "freeBusyReader");
    url.searchParams.set("fields", "nextPageToken,items(id)");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Google Calendar request failed (${res.status}).`);
    }

    const data = (await res.json()) as {
      nextPageToken?: string;
      items?: { id: string }[];
    };
    for (const item of data.items ?? []) ids.push(item.id);
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Fall back to primary if the list came back empty for any reason.
  return ids.length > 0 ? ids : ["primary"];
}

/**
 * Queries busy intervals across *all* the caller's calendars in
 * [timeMin, timeMaxExclusive) and returns them merged into a single list. The
 * whole booking window fits in one time range (FreeBusy allows up to ~3 months;
 * the window is at most ~a month); calendars are chunked to stay within the
 * per-request limit. Duplicate/overlapping intervals across calendars are
 * harmless for the caller's overlap check.
 */
export async function fetchBusyIntervals(
  token: string,
  timeMin: Date,
  timeMaxExclusive: Date,
): Promise<BusyInterval[]> {
  const calendarIds = await fetchCalendarIds(token);
  const intervals: BusyInterval[] = [];

  for (let i = 0; i < calendarIds.length; i += MAX_CALENDARS_PER_REQUEST) {
    const items = calendarIds
      .slice(i, i + MAX_CALENDARS_PER_REQUEST)
      .map((id) => ({ id }));

    const res = await fetch(FREEBUSY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMaxExclusive.toISOString(),
        items,
      }),
    });

    if (!res.ok) {
      throw new Error(`Google Calendar request failed (${res.status}).`);
    }

    const data = (await res.json()) as {
      calendars?: Record<
        string,
        { busy?: { start: string; end: string }[] }
      >;
    };
    // Each calendar reports its own busy blocks; a calendar we can't read
    // free/busy for comes back with `errors` and no `busy`, which we skip.
    for (const cal of Object.values(data.calendars ?? {})) {
      for (const b of cal.busy ?? []) {
        intervals.push({ start: new Date(b.start), end: new Date(b.end) });
      }
    }
  }

  return intervals;
}
