"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Pencil, Trash2, MapPin, CalendarPlus, ExternalLink, RefreshCw, ClipboardCheck, Check } from "lucide-react";
import { EventListSkeleton } from "@/components/skeletons";
import { accentTint, hoverForeground, DEFAULT_ACCENT } from "@/lib/portal-color";
import { downloadEventIcs } from "@/lib/ics";
import { dayKey, dayKeysFor } from "@/lib/event-days";
import { cn } from "@/lib/utils";
import { useRoleSim } from "@/components/role-simulation-provider";
import { CATEGORY_META, EVENT_CATEGORIES, isRoleGated, type EventCategory } from "@/lib/event-category";
import { usePortalMeta } from "@/components/portal-meta-provider";
import { EventFormDialog, deletePortalEvent, EVENT_FORM_SELECT, type EventFormValue } from "@/components/event-form-dialog";
import { PortalAttendanceModal } from "@/components/portal-attendance-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { googleSubscribeUrl, icsSubscribeUrl, publicCalendarId } from "@/lib/calendar-subscribe";

export type PortalEvent = {
  id: string;
  /** null = a club-wide event: no portal, visibility decided by role. */
  portal_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  category: EventCategory;
  attendance_enabled: boolean;
  category_overridden: boolean;
  external_source: string | null;
  external_link: string | null;
  cancelled_at: string | null;
  portals: { name: string; color: string | null } | null;
};

type Props = {
  // When set, the calendar shows only this portal's events and creates events
  // for it. When omitted, it's the aggregate view (every event the user can
  // see). Editing is gated per-event by whether the user manages that portal.
  portalId?: string;
  // Identity for the header band. Passed in rather than derived from the events'
  // `portals(name, color)` embed, because a portal with no events yet has no
  // embed to read — exactly when the band's label matters most.
  portalName?: string;
  portalColor?: string | null;
};

// What a club-wide event is labelled with on a portal calendar, where it sits
// next to events labelled with their portal's name.
const CLUB_LABEL = "Open Project";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// One event, tinted with its portal's accent color (whole-card, not a badge).
function EventCard({
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
  //
  // A categorized event is tinted by its category, so GMs, socials and board
  // meetings read apart at a glance even when they share one portal.
  // "general" events keep the portal tint — that's the pre-category behavior,
  // and every hand-created event defaults to it.
  const tint = ev.category !== "general" ? CATEGORY_META[ev.category].color : color;
  const cardBg = tint
    ? accentTint(tint, 18)!
    : "color-mix(in srgb, hsl(var(--accent)) 40%, hsl(var(--background)))";
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
            {showDate && `${formatDate(ev.start_time)} · `}
            {ev.all_day
              ? "All day"
              : `${formatTime(ev.start_time)}${ev.end_time ? ` – ${formatTime(ev.end_time)}` : ""}`}
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
              {isRoleGated(ev.category) && " \u00b7 board only"}
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

// The dashboard's subscribe control, sitting inside the calendar card above the
// month grid. Portal calendars don't get one: they mirror the club feed's
// events, but subscribing is a decision about the whole club's schedule, so it
// belongs in the one place that is about exactly that.
function SubscribeMenu() {
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
        <button className="mb-3 w-full flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
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

// On a portal page, a second card tinted with the portal's accent sits BEHIND
// the calendar and pokes out above it, so the portal's name reads as a tab on
// the stack. That says "this calendar belongs to that portal" — which matters
// now that club-wide events appear here too: the tab is what makes the mix read
// as "this portal, plus the club" rather than an unscoped calendar.
//
// `mt-PEEK` on the wrapper reserves the space the backing card borrows with its
// negative offset, so it never rides up over whatever sits above it.
const PEEK = "1.5rem";

function PortalBackingCard({
  name,
  color,
  children,
}: {
  name?: string;
  color?: string | null;
  children: React.ReactNode;
}) {
  if (!name) return <>{children}</>;

  return (
    <div className="relative" style={{ marginTop: PEEK }}>
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 rounded-xl border flex items-start"
        style={{
          top: `calc(-1 * ${PEEK})`,
          // The raw accent at full strength, exactly like the portal card's
          // hover swipe — so a portal reads the same color here as on the
          // dashboard. DEFAULT_ACCENT keeps a colorless portal intentional
          // rather than transparent. Border matches the fill so the peek is one
          // solid shape instead of a rimmed box.
          backgroundColor: color || DEFAULT_ACCENT,
          borderColor: color || DEFAULT_ACCENT,
        }}
      >
        <span
          className="px-3 text-xs font-medium truncate max-w-full"
          // Black or white, whichever wins on contrast against that accent —
          // the same hoverForeground() the portal cards use for their swipe.
          style={{ lineHeight: PEEK, color: hoverForeground(color) }}
        >
          {name}
        </span>
      </div>
      {/* `relative` lifts the calendar above the backing card; its opaque
          background is what clips the backing card down to the peeking strip. */}
      <div className="relative">{children}</div>
    </div>
  );
}

export function CalendarPanel({ portalId, portalName, portalColor }: Props) {
  const { ready, isExec, isBoardOrExec } = useRoleSim();
  const { overrides } = usePortalMeta();

  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedKey, setSelectedKey] = useState<string>(dayKey(today));
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // null = no filter. Otherwise only this category is shown.
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | null>(null);

  // Portals the current user can manage events for (exec ⇒ all).
  const [manageablePortals, setManageablePortals] = useState<{ id: string; name: string }[]>([]);
  // Portals the user genuinely belongs to (member row / role / linked project),
  // used to filter the aggregate calendar so a simulated non-exec persona doesn't
  // see events from every portal (RLS returns them all to the real exec user).
  // null = not resolved yet.
  const [visiblePortalIds, setVisiblePortalIds] = useState<Set<string> | null>(null);

  // Club-wide tools, dashboard only. The club calendar has no portal, so its
  // attendance sheet and its Google sync have no portal settings page to live
  // on — they belong here, next to the events they act on.
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const showClubTools = !portalId && isBoardOrExec;

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PortalEvent | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
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
    if (portalId) query = query.or(`portal_id.eq.${portalId},portal_id.is.null`);
    const { data } = await query;
    // `portals(name, color)` is a to-one FK embed (object at runtime); supabase-js
    // infers it as an array without generated types, so cast.
    setEvents((data ?? []) as unknown as PortalEvent[]);
    setLoading(false);
  }, [portalId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Compute the user's manageable portals (mirrors the dashboard's admin-set logic).
  useEffect(() => {
    if (!ready) return;
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

  // An in-session portal settings save lands in `overrides` first, so the band
  // retints without a reload — same precedence resolve() uses for event tints.
  const bandName = portalId ? overrides[portalId]?.name ?? portalName : undefined;
  const bandColor = portalId
    ? (overrides[portalId] ? overrides[portalId].color : portalColor) ?? null
    : null;

  const manageableIds = useMemo(() => new Set(manageablePortals.map((p) => p.id)), [manageablePortals]);
  const canManage = (pid: string) => manageableIds.has(pid);
  // A club event (no portal) is exec-managed; RLS enforces the same split.
  const canManageEvent = (ev: PortalEvent) => (ev.portal_id === null ? isExec : canManage(ev.portal_id));
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
    const seen = new Set(permittedEvents.map((e) => e.category));
    return EVENT_CATEGORIES.filter((c) => seen.has(c));
  }, [permittedEvents]);

  const visibleEvents = useMemo(
    () => (categoryFilter ? permittedEvents.filter((e) => e.category === categoryFilter) : permittedEvents),
    [permittedEvents, categoryFilter],
  );

  // Bucket events by local day key for quick lookup while rendering the grid.
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

  // "Upcoming" = the next 5 events from now forward (includes later-today events).
  const upcoming = useMemo(
    () =>
      visibleEvents
        .filter((e) => new Date(e.start_time).getTime() >= today.getTime())
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        .slice(0, 5),
    [visibleEvents, today],
  );

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const leadingBlanks = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const goPrev = () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goNext = () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedKey(dayKey(today));
  };

  const jumpTo = (iso: string) => {
    const d = new Date(iso);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedKey(dayKey(d));
  };

  const selectedEvents = eventsByDay.get(selectedKey) ?? [];

  const openCreate = () => {
    setEditingEvent(null);
    setFormOpen(true);
  };

  const openEdit = (ev: PortalEvent) => {
    setEditingEvent(ev);
    setFormOpen(true);
  };

  const handleSaved = (saved: EventFormValue) => {
    setEvents((prev) =>
      prev.some((e) => e.id === saved.id) ? prev.map((e) => (e.id === saved.id ? saved : e)) : [...prev, saved],
    );
    jumpTo(saved.start_time);
  };

  const syncCalendar = async () => {
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
  };

  const deleteEvent = async (ev: PortalEvent) => {
    if (!window.confirm(`Delete "${ev.title}"? This can't be undone.`)) return;
    setDeletingId(ev.id);
    const ok = await deletePortalEvent(ev.id);
    if (!ok) { setDeletingId(null); return; }
    setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    setDeletingId(null);
  };

  return (
    <PortalBackingCard name={bandName} color={bandColor}>
    <div className="border rounded-xl p-4 bg-background">
      {!portalId && <SubscribeMenu />}

      <div className="flex flex-col sm:flex-row lg:flex-col gap-4 lg:gap-3">
        {/* Month section (shrinks when the events sections sit beside it). */}
        <div className="w-full sm:w-1/2 lg:w-full flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm select-none">
              {MONTHS[viewMonth]} {viewYear}
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={goToday}
                className="text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors px-2 py-1 rounded-md border"
                aria-label="Go to today"
              >
                Today
              </button>
              <button onClick={goPrev} className="text-muted-foreground hover:text-foreground transition-colors p-1" aria-label="Previous month">
                <ChevronLeft size={16} />
              </button>
              <button onClick={goNext} className="text-muted-foreground hover:text-foreground transition-colors p-1" aria-label="Next month">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-[10px] font-medium text-muted-foreground uppercase py-1 select-none">
                {w}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />;
              const key = dayKey(new Date(viewYear, viewMonth, day));
              const dayEvents = eventsByDay.get(key) ?? [];
              const isToday = key === dayKey(today);
              const isSelected = key === selectedKey;
              return (
                <div key={key} className="relative">
                  <button
                    onClick={() => setSelectedKey(key)}
                    onMouseEnter={() => setHoverKey(key)}
                    onMouseLeave={() => setHoverKey((k) => (k === key ? null : k))}
                    className={`w-full aspect-square rounded-md flex flex-col items-center justify-start pt-1 text-xs transition-colors ${
                      isSelected ? "bg-foreground text-background" : isToday ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <span className={isToday && !isSelected ? "font-bold" : ""}>{day}</span>
                    {dayEvents.length > 0 && (
                      <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${isSelected ? "bg-background" : "bg-foreground"}`} />
                    )}
                  </button>

                  {/* Hover preview of the day's events, floated above the tile. */}
                  {hoverKey === key && dayEvents.length > 0 && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-30 w-52 pointer-events-none flex flex-col gap-1 rounded-lg border bg-popover p-2 shadow-lg text-left">
                      {dayEvents.map((ev) => {
                        const { name, color } = resolve(ev);
                        return <EventCard key={ev.id} ev={ev} name={name} color={color} actions={false} />;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {presentCategories.length > 1 && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setCategoryFilter(null)}
                aria-pressed={categoryFilter === null}
                className={cn(
                  "text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors",
                  categoryFilter === null
                    ? "bg-foreground text-background border-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                All
              </button>
              {presentCategories.map((c) => {
                const active = categoryFilter === c;
                return (
                  <button
                    key={c}
                    onClick={() => setCategoryFilter(active ? null : c)}
                    aria-pressed={active}
                    className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1",
                      active ? "text-background" : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                    style={
                      active
                        ? { backgroundColor: CATEGORY_META[c].color, borderColor: CATEGORY_META[c].color }
                        : undefined
                    }
                  >
                    {!active && (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: CATEGORY_META[c].color }}
                      />
                    )}
                    {CATEGORY_META[c].label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Events sections: divider swaps between top (stacked) and left (split). */}
        <div className="w-full sm:flex-1 lg:w-full min-w-0 flex flex-col gap-4 border-t pt-3 sm:border-t-0 sm:pt-0 sm:border-l sm:pl-4 lg:border-l-0 lg:pl-0 lg:border-t lg:pt-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {new Date(`${selectedKey}T00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
              </span>
              {canAdd && (
                <button onClick={openCreate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Plus size={13} /> Add event
                </button>
              )}
            </div>

            {loading ? (
              <EventListSkeleton count={2} />
            ) : selectedEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedEvents.map((ev) => {
                  const { name, color } = resolve(ev);
                  const manage = canManageEvent(ev);
                  return (
                    <EventCard
                      key={ev.id}
                      ev={ev}
                      name={name}
                      color={color}
                      onEdit={manage ? () => openEdit(ev) : undefined}
                      // Deleting a synced row just resurrects it on the next
                      // sync, minus its attendance — remove it in Google instead.
                      onDelete={manage && !ev.external_source ? () => deleteEvent(ev) : undefined}
                      deleting={deletingId === ev.id}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {!loading && upcoming.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</span>
              <div className="flex flex-col gap-2">
                {upcoming.map((ev) => {
                  const { name, color } = resolve(ev);
                  return (
                    <EventCard
                      key={ev.id}
                      ev={ev}
                      name={name}
                      color={color}
                      showDate
                      onClick={() => jumpTo(ev.start_time)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {showClubTools && (
        <div className="flex flex-col gap-1.5 border-t mt-3 pt-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAttendanceOpen(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ClipboardCheck size={13} /> Club attendance
            </button>
            {isExec && (
              <button
                onClick={syncCalendar}
                disabled={syncing}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={syncing ? "animate-spin" : undefined} />
                {syncing ? "Syncing..." : "Sync Google Calendar"}
              </button>
            )}
          </div>
          {syncResult && <p className="text-[11px] text-muted-foreground">{syncResult}</p>}
        </div>
      )}

      {showClubTools && (
        <PortalAttendanceModal
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          canManage={isBoardOrExec}
          canEditEvents={isExec}
        />
      )}

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editingEvent}
        portalId={portalId}
        portals={portalId ? undefined : manageablePortals}
        allowClubEvent={!portalId && isExec}
        defaultDate={selectedKey}
        onSaved={handleSaved}
      />
    </div>
    </PortalBackingCard>
  );
}
