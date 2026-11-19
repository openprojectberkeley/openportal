"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  deriveAttendanceAnalytics,
  type AttendanceRaw,
  type RawEvent,
  type RawMark,
  type Window,
} from "@/lib/attendance-analytics";

// Everything the exec Attendance tab shows, in one parallel round of plain
// table reads. Exec can read every attendance row under RLS (0111), so no RPC.

// PostgREST caps a response at 1000 rows; page until a short page comes back.
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

async function load(startsOn: string | null): Promise<AttendanceRaw> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();

  const [events, portals, projects, members, marks] = await Promise.all([
    fetchAll<RawEvent>((a, b) => {
      let q = supabase
        .from("portal_events")
        .select("id, portal_id, title, category, start_time, cancelled_at")
        .eq("attendance_enabled", true)
        .is("cancelled_at", null)
        .lt("start_time", nowIso);
      if (startsOn) q = q.gte("start_time", startsOn);
      return q.order("id").range(a, b);
    }),
    supabase.from("portals").select("id, project_id, color").eq("type", "project").then(must),
    supabase.from("projects").select("id, name, color").then(must),
    fetchAll<{ user_id: string; preferred_firstname: string | null; lastname: string | null; status: string | null }>(
      (a, b) =>
        supabase.from("members").select("user_id, preferred_firstname, lastname, status").order("user_id").range(a, b),
    ),
    fetchAll<RawMark>((a, b) => {
      let q = supabase
        .from("portal_event_attendance")
        .select("event_id, user_id, status, portal_events!inner(start_time)")
        .lt("portal_events.start_time", nowIso);
      if (startsOn) q = q.gte("portal_events.start_time", startsOn);
      return q.order("id").range(a, b);
    }),
  ]);

  const projectPortals = (portals as { id: string; project_id: string | null; color: string | null }[]).filter(
    (p) => p.project_id,
  );
  const projectById = new Map((projects as { id: string; name: string; color: string | null }[]).map((p) => [p.id, p]));
  const portalIds = projectPortals.map((p) => p.id);

  const rosters = portalIds.length
    ? await fetchAll<{ portal_id: string; user_id: string }>((a, b) =>
        supabase.from("portal_members").select("portal_id, user_id").in("portal_id", portalIds).order("id").range(a, b),
      )
    : [];

  return {
    events,
    projects: projectPortals.flatMap((p) => {
      const proj = projectById.get(p.project_id!);
      return proj ? [{ portal_id: p.id, project_id: proj.id, name: proj.name, color: proj.color ?? p.color }] : [];
    }),
    rosters,
    members: members.map((m) => ({
      user_id: m.user_id,
      name: `${m.preferred_firstname ?? ""} ${m.lastname ?? ""}`.trim() || "Unknown",
      active: m.status === "active",
    })),
    marks: marks.map(({ event_id, user_id, status }) => ({ event_id, user_id, status })),
  };
}

/**
 * `window.key` identifies the range (null = not ready yet). Bumping `reload`
 * refetches in place, keeping the current numbers on screen meanwhile.
 */
export function useAttendanceAnalytics(window: (Window & { key: string }) | null, reload = 0) {
  const key = window?.key ?? null;
  const startsOn = window?.startsOn ?? null;
  const endsOn = window?.endsOn ?? null;
  const [state, setState] = useState<{ key: string | null; raw: AttendanceRaw | null; error: string | null }>({
    key: null,
    raw: null,
    error: null,
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    load(startsOn).then(
      (raw) => !cancelled && setState({ key, raw, error: null }),
      (e: unknown) =>
        !cancelled &&
        setState({ key, raw: null, error: e instanceof Error ? e.message : "Couldn't load attendance analytics." }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, startsOn, reload]);

  const current = state.key === key;
  const data = useMemo(
    () => (current && state.raw ? deriveAttendanceAnalytics(state.raw, { startsOn, endsOn }) : null),
    [current, state.raw, startsOn, endsOn],
  );

  return { data, loading: !!key && !current, error: current ? state.error : null };
}
