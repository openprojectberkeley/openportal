// Pulls the club's public Google Calendar into portal_events.
//
// Authorized two ways, because it has two callers:
//   - an exec session  → the "Sync now" button in portal settings (POST)
//   - a CRON_SECRET bearer token → the scheduled run (vercel.json). Vercel
//     invokes crons with GET, so GET is exposed too — but only ever for the
//     cron secret, never for a session, so no browser navigation can trigger a
//     write just by loading the URL.
//
// Writes go through the service-role client: a cron run has no session, and the
// portal_events INSERT policy requires `created_by = auth.uid()`. The caller is
// authorized above before that client is ever constructed.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsExec } from "@/lib/roles";
import {
  GoogleCalendarError,
  calendarConfig,
  fetchCalendarEvents,
  type NormalizedEvent,
} from "@/lib/google-calendar-feed";
import { ATTENDANCE_BY_DEFAULT, categorize } from "@/lib/event-category";

const SOURCE = "gcal";

// How much of the calendar to mirror. Back far enough to keep this semester's
// attendance history in range, forward far enough to cover next semester's
// schedule as soon as it's drafted.
const MONTHS_BACK = 6;
const MONTHS_FORWARD = 12;

type ExistingRow = {
  id: string;
  external_id: string;
  start_time: string;
  external_etag: string | null;
  category: string;
  category_overridden: boolean;
  attendance_enabled: boolean;
  cancelled_at: string | null;
};

/** Timing-safe-ish comparison for the cron bearer token. */
function secretMatches(header: string | null, expected: string): boolean {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function isCron(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(cronSecret) && secretMatches(req.headers.get("authorization"), cronSecret!);
}

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  if (isCron(req)) return { ok: true };

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // Honors the VP Tech/President "view as" simulation cookie, like the other
  // admin routes — an exec simulating a member shouldn't be able to sync.
  const accessLevels = await getEffectiveAccessLevels(supabase);
  if (!accessIsExec(accessLevels)) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

async function runSync(): Promise<NextResponse> {
  let config: { calendarId: string; apiKey: string };
  try {
    config = calendarConfig();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const now = new Date();
  const timeMin = new Date(now); timeMin.setMonth(timeMin.getMonth() - MONTHS_BACK);
  const timeMax = new Date(now); timeMax.setMonth(timeMax.getMonth() + MONTHS_FORWARD);

  let events: NormalizedEvent[];
  try {
    events = await fetchCalendarEvents(config.calendarId, { timeMin, timeMax, apiKey: config.apiKey });
  } catch (e) {
    const status = e instanceof GoogleCalendarError ? 502 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  const admin = createAdminClient();

  // Synced events are club events: no portal, visibility decided by role
  // (migration 0095). There is no "Open Project" portal to look up or keep
  // a roster for.
  const { data: existingRows, error: existingError } = await admin
    .from("portal_events")
    .select("id, external_id, start_time, external_etag, category, category_overridden, attendance_enabled, cancelled_at")
    .is("portal_id", null)
    .eq("external_source", SOURCE);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const existing = new Map<string, ExistingRow>(
    ((existingRows ?? []) as ExistingRow[]).map((r) => [r.external_id, r]),
  );

  const syncedAt = new Date().toISOString();
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];
  let unchanged = 0;
  let cancelled = 0;

  const seen = new Set<string>();

  for (const ev of events) {
    seen.add(ev.external_id);
    const prior = existing.get(ev.external_id);

    if (!prior) {
      // A cancelled instance we've never seen isn't worth a row.
      if (ev.cancelled) continue;
      const category = categorize(ev.title, ev.description);
      toInsert.push({
        portal_id: null,
        title: ev.title,
        description: ev.description,
        location: ev.location,
        start_time: ev.start_time,
        end_time: ev.end_time,
        all_day: ev.all_day,
        category,
        attendance_enabled: ATTENDANCE_BY_DEFAULT[category],
        category_overridden: false,
        created_by: null,
        external_source: SOURCE,
        external_id: ev.external_id,
        external_etag: ev.external_etag,
        external_link: ev.external_link,
        synced_at: syncedAt,
      });
      continue;
    }

    if (ev.cancelled) {
      // Soft-cancel only: portal_event_attendance cascades on delete, so
      // removing the row would destroy attendance for a meeting that happened.
      if (!prior.cancelled_at) {
        toUpdate.push({ id: prior.id, patch: { cancelled_at: syncedAt, synced_at: syncedAt } });
        cancelled++;
      } else {
        unchanged++;
      }
      continue;
    }

    // Nothing changed in Google and the row isn't stale — skip the write.
    if (prior.external_etag && prior.external_etag === ev.external_etag && !prior.cancelled_at) {
      unchanged++;
      continue;
    }

    const patch: Record<string, unknown> = {
      title: ev.title,
      description: ev.description,
      location: ev.location,
      start_time: ev.start_time,
      end_time: ev.end_time,
      all_day: ev.all_day,
      external_etag: ev.external_etag,
      external_link: ev.external_link,
      synced_at: syncedAt,
      // An event un-cancelled in Google comes back to life here too.
      cancelled_at: null,
      // portal_events has no updated_at trigger (see event-form-dialog.tsx).
      updated_at: syncedAt,
    };

    // A category an admin set by hand is theirs — the rules must not stomp it
    // on the next sync. Same for the attendance toggle, which follows from it.
    if (!prior.category_overridden) {
      const category = categorize(ev.title, ev.description);
      if (category !== prior.category) {
        patch.category = category;
        patch.attendance_enabled = ATTENDANCE_BY_DEFAULT[category];
      }
    }

    toUpdate.push({ id: prior.id, patch });
  }

  // Reconcile rows Google no longer returns at all. `showDeleted` surfaces a
  // deletion as a cancelled instance only for a while; after Google purges it,
  // the event simply stops appearing and the row would otherwise linger as a
  // ghost on the calendar forever.
  //
  // Scoped to rows whose start falls INSIDE the fetched window — anything
  // outside it is absent because we didn't ask for it, not because it's gone.
  const minMs = timeMin.getTime();
  const maxMs = timeMax.getTime();
  for (const row of existing.values()) {
    if (seen.has(row.external_id) || row.cancelled_at) continue;
    const startMs = new Date(row.start_time).getTime();
    if (Number.isNaN(startMs) || startMs < minMs || startMs >= maxMs) continue;
    toUpdate.push({ id: row.id, patch: { cancelled_at: syncedAt, synced_at: syncedAt } });
    cancelled++;
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from("portal_events").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const { id, patch } of toUpdate) {
    const { error } = await admin.from("portal_events").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    created: toInsert.length,
    updated: toUpdate.length - cancelled,
    cancelled,
    unchanged,
    fetched: events.length,
    synced_at: syncedAt,
  });
}

/** Manual "Sync now" — an exec session, or the cron secret. */
export async function POST(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) return auth.res;
  return runSync();
}

/** Scheduled run. Cron secret only — a session is never enough for a GET. */
export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runSync();
}
