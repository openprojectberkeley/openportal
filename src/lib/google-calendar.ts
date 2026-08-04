// Client-side Google Calendar free/busy helper.
//
// This is deliberately independent of the app's Supabase Google login (which
// only requests identity scopes). It uses Google Identity Services (GIS) to
// obtain a short-lived access token for the read-only `calendar.freebusy`
// scope, then queries the FreeBusy REST endpoint (which supports browser CORS)
// directly. Nothing is persisted — the token lives only for the duration of a
// single sync, and no refresh token or client secret is involved.
//
// Requires the GIS script (https://accounts.google.com/gsi/client) to be loaded
// on the page and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to be set.

const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";

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
 * scoped to `calendar.freebusy`. Rejects if the user denies/closes the popup,
 * the popup is blocked, or the GIS script / client id is unavailable.
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
      scope: FREEBUSY_SCOPE,
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
 * Queries the caller's primary calendar for busy intervals in
 * [timeMin, timeMaxExclusive). The whole booking window fits in one request
 * (FreeBusy allows up to ~3 months; the window is at most ~a month).
 */
export async function fetchBusyIntervals(
  token: string,
  timeMin: Date,
  timeMaxExclusive: Date,
): Promise<BusyInterval[]> {
  const res = await fetch(FREEBUSY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMaxExclusive.toISOString(),
      items: [{ id: "primary" }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Google Calendar request failed (${res.status}).`);
  }

  const data = (await res.json()) as {
    calendars?: { primary?: { busy?: { start: string; end: string }[] } };
  };
  const busy = data.calendars?.primary?.busy ?? [];
  return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}
