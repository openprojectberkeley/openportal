"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dayKeysFor } from "@/lib/event-days";
import { useRoleSim } from "@/components/role-simulation-provider";
import { usePortalMeta } from "@/components/portal-meta-provider";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { EVENT_CATEGORIES, isRoleGated, type EventCategory } from "@/lib/event-category";
import { EVENT_FORM_SELECT, type EventFormValue } from "@/components/event-form-dialog";
import {
  CLUB_PORTAL_KEY,
  comparePortalOptions,
  matchesFilters,
  portalKeyOf,
  toggleFilterKey,
  type PortalFilterOption,
} from "@/lib/calendar-filters";

export { CLUB_PORTAL_KEY, type PortalFilterOption };

// Canonical select for every portal_events read, re-exported rather than
// re-spelled: the `portals!portal_events_portal_id_fkey` hint is load-bearing
// (portal_imported_events is a second portal_events↔portals path, so a bare
// `portals(...)` embed fails PGRST201 as ambiguous), and two copies of it is
// one copy that can drift.
export { EVENT_FORM_SELECT as CALENDAR_EVENT_SELECT };

/** A calendar row. Structurally identical to EventFormValue by design. */
export type PortalEvent = EventFormValue;

export type ManageablePortal = { id: string; name: string };

/**
 * What a club-wide event is labelled with on a portal calendar, where it sits
 * next to events labelled with their portal's name.
 */
const CLUB_LABEL = "Open Project";

/**
 * Everything the calendar views share: the fetch, the permission mirror, the
 * day bucketing, the category filter, and the club-wide Google sync.
 *
 * Lives here rather than in the mini panel so the panel and the full /calendar
 * page cannot drift from each other — or, more importantly, from RLS.
 *
 * `portalId` set = that portal's events plus the club-wide ones; omitted = the
 * aggregate view (every event the user can see).
 */
export function useCalendarEvents({ portalId }: { portalId?: string } = {}) {
  const { ready, isExec, isBoardOrExec } = useRoleSim();
  const { overrides } = usePortalMeta();

  // null until the first load lands — the repo's null-until-loaded convention,
  // so consumers can tell "no events" from "not asked yet".
  const [events, setEvents] = useState<PortalEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Both filters are multi-select, and an empty set means "no filter on this
  // dimension" — so one control covers both "show all" and "show these".
  const [categoryFilter, setCategoryFilter] = useState<Set<EventCategory>>(new Set());
  const [portalFilter, setPortalFilter] = useState<Set<string>>(new Set());

  // Portals the current user can manage events for (exec ⇒ all).
  const [manageablePortals, setManageablePortals] = useState<ManageablePortal[]>([]);
  // Portals the user genuinely belongs to (member row / role / linked project),
  // used to filter the aggregate calendar so a simulated non-exec persona doesn't
  // see events from every portal (RLS returns them all to the real exec user).
  // null = not resolved yet.
  const [visiblePortalIds, setVisiblePortalIds] = useState<Set<string> | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // TWO generation refs, not one. These are independent multi-await sequences
  // on different dep keys (events ← portalId; perms ← ready/isExec), so a
  // single shared counter would let a perms load silently cancel an in-flight
  // events reload — leaving the caller stuck on its skeleton forever.
  const eventsGenRef = useRef(0);
  const permsGenRef = useRef(0);

  const loadEvents = useCallback(async () => {
    const gen = ++eventsGenRef.current;
    const supabase = createClient();
    let query = supabase
      .from("portal_events")
      .select(EVENT_FORM_SELECT)
      // Events deleted in Google are soft-cancelled, not removed, so their
      // attendance history survives — but they shouldn't show on the calendar.
      .is("cancelled_at", null)
      .order("start_time");
    // A portal calendar shows the portal's own events *and* the club-wide ones
    // (portal_id null — the synced Google feed plus any hand-made club event).
    // The club schedule is everyone's schedule, so a portal's members shouldn't
    // have to go back to the dashboard to see when the next GM is. RLS already
    // decides who may read a club event (board-only ones stay hidden), so this
    // widens the query without widening access.
    //
    // Deliberately unbounded in time: portal_events is one club's calendar
    // (low hundreds of rows a year including the Google feed), and holding all
    // of it makes month/week/agenda navigation instant with no refetch race. A
    // correct range predicate would also have to be
    // `start_time < end AND coalesce(end_time, start_time) >= start` to keep a
    // retreat that starts Aug 31 in September's grid — exactly the multi-day
    // bug event-days.ts was extracted to fix. Revisit past ~2k rows.
    if (portalId) query = query.or(`portal_id.eq.${portalId},portal_id.is.null`);
    const { data, error: selectError } = await query;
    if (gen !== eventsGenRef.current) return;
    if (selectError) {
      setError("Couldn't load the calendar.");
      setEvents([]);
      return;
    }
    setError(null);
    // `portals(name, color)` is a to-one FK embed (object at runtime); supabase-js
    // infers it as an array without generated types, so cast.
    setEvents((data ?? []) as unknown as PortalEvent[]);
  }, [portalId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // These views live in long-lived client trees (the dashboard sidebar, the
  // calendar page), so a tab switch or a bfcache restore would otherwise leave
  // them showing a stale schedule.
  useRefreshOnReturn(loadEvents);

  // Compute the user's manageable portals (mirrors the dashboard's admin-set logic).
  useEffect(() => {
    if (!ready) return;
    const gen = ++permsGenRef.current;
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: portalRows }, { data: memberRows }, { data: roleRows }, { data: portalRoleRows }, { data: myProjectRows }] =
        await Promise.all([
          supabase.from("portals").select("id, name, project_id").order("name"),
          supabase.from("portal_members").select("portal_id, is_admin").eq("user_id", user.id),
          supabase.from("members_roles").select("role_id").eq("user_id", user.id),
          supabase.from("portal_roles").select("portal_id, role_id, is_admin"),
          supabase.from("project_members").select("project_id").eq("user_id", user.id),
        ]);
      if (gen !== permsGenRef.current) return;
      const myRoleIds = new Set((roleRows ?? []).map((r) => r.role_id));
      const adminByRole = new Set(
        (portalRoleRows ?? []).filter((pr) => pr.is_admin && myRoleIds.has(pr.role_id)).map((pr) => pr.portal_id),
      );
      const adminByRow = new Set((memberRows ?? []).filter((m) => m.is_admin).map((m) => m.portal_id));
      setManageablePortals(
        (portalRows ?? [])
          .filter((p) => isExec || adminByRow.has(p.id) || adminByRole.has(p.id))
          .map((p) => ({ id: p.id, name: p.name })),
      );

      // Genuine memberships (independent of exec's see-all) for the event filter.
      const myProjectIds = new Set((myProjectRows ?? []).map((r) => r.project_id));
      const memberByRow = new Set((memberRows ?? []).map((m) => m.portal_id));
      const memberByRole = new Set(
        (portalRoleRows ?? []).filter((pr) => myRoleIds.has(pr.role_id)).map((pr) => pr.portal_id),
      );
      setVisiblePortalIds(new Set<string>([
        ...memberByRow,
        ...memberByRole,
        ...(portalRows ?? []).filter((p) => p.project_id && myProjectIds.has(p.project_id)).map((p) => p.id),
      ]));
    })();
  }, [ready, isExec]);

  const manageableIds = useMemo(() => new Set(manageablePortals.map((p) => p.id)), [manageablePortals]);
  const canManage = useCallback((pid: string) => manageableIds.has(pid), [manageableIds]);
  // A club event (no portal) is exec-managed; RLS enforces the same split.
  const canManageEvent = useCallback(
    (ev: PortalEvent) => (ev.portal_id === null ? isExec : canManage(ev.portal_id)),
    [isExec, canManage],
  );
  const canAdd = portalId ? canManage(portalId) : manageablePortals.length > 0 || isExec;

  // Resolve a portal's live name/color: an in-session settings save (context)
  // wins over the value embedded at fetch time.
  const resolve = useCallback(
    (ev: PortalEvent): { name: string | null; color: string | null } => {
      // Club events have no portal to tint them with — their category color
      // carries that. On the dashboard the category badge is identity enough;
      // inside a portal calendar, where every other card is labelled with the
      // portal's name, they need a label of their own so a club-wide event
      // doesn't read as one of this portal's.
      if (ev.portal_id === null) return { name: portalId ? CLUB_LABEL : null, color: null };
      const o = overrides[ev.portal_id];
      return {
        name: o?.name ?? ev.portals?.name ?? null,
        color: (o ? o.color : ev.portals?.color) ?? null,
      };
    },
    [overrides, portalId],
  );

  // On the aggregate (dashboard) calendar, hide events from portals the user
  // doesn't genuinely belong to when viewing as a non-exec persona — RLS returns
  // all of them to the real exec user, so we filter client-side. A per-portal
  // calendar (portalId set) and a real/simulated exec view are unfiltered.
  const permittedEvents = useMemo(() => {
    if (events === null) return null;
    // Board-category events are role-gated, not portal-gated (RLS in 0093).
    // RLS already enforces this for real users; mirroring it here is what makes
    // the "view as → Member" simulation honest, since RLS still answers as the
    // real exec.
    const roleFiltered = isBoardOrExec ? events : events.filter((e) => !isRoleGated(e.category));
    if (portalId || isExec) return roleFiltered;
    if (visiblePortalIds === null) return [];
    return roleFiltered.filter((e) => e.portal_id === null || visiblePortalIds.has(e.portal_id));
  }, [events, portalId, isExec, isBoardOrExec, visiblePortalIds]);

  // Categories actually present, so the chips never offer an empty filter.
  const presentCategories = useMemo(() => {
    const seen = new Set((permittedEvents ?? []).map((e) => e.category));
    return EVENT_CATEGORIES.filter((c) => seen.has(c));
  }, [permittedEvents]);

  // Portals that actually have visible events, so the chips never offer an
  // empty filter. Derived from permittedEvents rather than visibleEvents, so
  // neither filter can make the other's options disappear mid-use.
  const presentPortals = useMemo<PortalFilterOption[]>(() => {
    const seen = new Map<string, PortalFilterOption>();
    for (const ev of permittedEvents ?? []) {
      const key = portalKeyOf(ev);
      if (seen.has(key)) continue;
      // resolve() already applies the override-wins-over-embed precedence; it
      // reports a club event as nameless on the aggregate calendar, which is
      // where this row lives, so the club label is supplied here.
      const { name, color } = resolve(ev);
      seen.set(key, {
        key,
        name: ev.portal_id === null ? CLUB_LABEL : name ?? "Untitled portal",
        color,
      });
    }
    return [...seen.values()].sort(comparePortalOptions);
  }, [permittedEvents, resolve]);

  const togglePortal = useCallback((key: string) => {
    setPortalFilter((prev) => toggleFilterKey(prev, key));
  }, []);

  const clearPortalFilter = useCallback(() => setPortalFilter(new Set()), []);

  const toggleCategory = useCallback((c: EventCategory) => {
    setCategoryFilter((prev) => toggleFilterKey(prev, c));
  }, []);

  const clearCategoryFilter = useCallback(() => setCategoryFilter(new Set()), []);

  const visibleEvents = useMemo(
    () => (permittedEvents ?? []).filter((e) => matchesFilters(e, categoryFilter, portalFilter)),
    [permittedEvents, categoryFilter, portalFilter],
  );

  // Bucket events by local day key for quick lookup while rendering a grid.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, PortalEvent[]>();
    for (const ev of visibleEvents) {
      for (const key of dayKeysFor(ev)) {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
      }
    }
    return map;
  }, [visibleEvents]);

  /** Fold a just-saved event into the local list (insert or replace). */
  const applySaved = useCallback((saved: PortalEvent) => {
    setEvents((prev) =>
      prev === null
        ? [saved]
        : prev.some((e) => e.id === saved.id)
          ? prev.map((e) => (e.id === saved.id ? saved : e))
          : [...prev, saved],
    );
  }, []);

  const applyDeleted = useCallback((id: string) => {
    setEvents((prev) => (prev === null ? prev : prev.filter((e) => e.id !== id)));
  }, []);

  const syncGoogleCalendar = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/calendar-sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setSyncResult(body.error ?? `Sync failed (${res.status}).`);
      } else {
        setSyncResult(
          `${body.created} added, ${body.updated} updated, ${body.cancelled} cancelled.`,
        );
        await loadEvents();
      }
    } catch {
      setSyncResult("Sync failed — check your connection and try again.");
    } finally {
      setSyncing(false);
    }
  }, [loadEvents]);

  return {
    /** null until the first load lands. Permission-mirrored and role-filtered. */
    events: permittedEvents,
    /** `events` narrowed by the active category filter. */
    visibleEvents,
    /** local YYYY-MM-DD → events on that day (a multi-day event is on each). */
    eventsByDay,
    presentCategories,
    /** Empty = show every category. Otherwise only these. */
    categoryFilter,
    toggleCategory,
    clearCategoryFilter,
    /** Portals (plus the club) that have visible events, club first then A-Z. */
    presentPortals,
    /** Empty = show every portal. Otherwise only these keys. */
    portalFilter,
    togglePortal,
    clearPortalFilter,
    manageablePortals,
    canAdd,
    canManageEvent,
    resolve,
    applySaved,
    applyDeleted,
    syncing,
    syncResult,
    syncGoogleCalendar,
    error,
    reload: loadEvents,
  };
}
