"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, MapPin, CalendarPlus } from "lucide-react";
import { EventListSkeleton } from "@/components/skeletons";
import { accentTint } from "@/lib/portal-color";
import { downloadEventIcs } from "@/lib/ics";
import { cn } from "@/lib/utils";
import { useRoleSim } from "@/components/role-simulation-provider";
import { usePortalMeta } from "@/components/portal-meta-provider";
import { EventFormDialog, deletePortalEvent, EVENT_FORM_SELECT, type EventFormValue } from "@/components/event-form-dialog";

export type PortalEvent = {
  id: string;
  portal_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  portals: { name: string; color: string | null } | null;
};

type Props = {
  // When set, the calendar shows only this portal's events and creates events
  // for it. When omitted, it's the aggregate view (every event the user can
  // see). Editing is gated per-event by whether the user manages that portal.
  portalId?: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Local YYYY-MM-DD key for a Date (used to bucket events by day).
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  const cardBg = color
    ? accentTint(color, 18)!
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
        {name && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap max-w-[8rem] truncate flex-shrink-0" title={name}>
            {name}
          </span>
        )}
      </div>

      {/* Controls overlay the bottom-right on hover — no layout space taken. A
          gradient in the card's own colour washes out the content beneath. */}
      {actions && (
        <div
          className="absolute inset-0 flex items-end justify-end p-1.5 opacity-0 group-hover/event:opacity-100 focus-within:opacity-100 transition-opacity pointer-events-none"
          style={{ background: `linear-gradient(to top left, ${cardBg} 0%, ${cardBg} 22%, transparent 60%)` }}
        >
          <div className="flex items-center gap-0.5 pointer-events-auto">
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

export function CalendarPanel({ portalId }: Props) {
  const { ready, isExec } = useRoleSim();
  const { overrides } = usePortalMeta();

  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedKey, setSelectedKey] = useState<string>(dayKey(today));
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Portals the current user can manage events for (exec ⇒ all).
  const [manageablePortals, setManageablePortals] = useState<{ id: string; name: string }[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PortalEvent | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    const supabase = createClient();
    let query = supabase.from("portal_events").select(EVENT_FORM_SELECT).order("start_time");
    if (portalId) query = query.eq("portal_id", portalId);
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
      const [{ data: portalRows }, { data: memberRows }, { data: roleRows }, { data: portalRoleRows }] =
        await Promise.all([
          supabase.from("portals").select("id, name").order("name"),
          supabase.from("portal_members").select("portal_id, is_admin").eq("user_id", user.id),
          supabase.from("members_roles").select("role_id").eq("user_id", user.id),
          supabase.from("portal_roles").select("portal_id, role_id, is_admin"),
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
    })();
  }, [ready, isExec]);

  const manageableIds = useMemo(() => new Set(manageablePortals.map((p) => p.id)), [manageablePortals]);
  const canManage = (pid: string) => manageableIds.has(pid);
  const canAdd = portalId ? canManage(portalId) : manageablePortals.length > 0;

  // Resolve a portal's live name/color: an in-session settings save (context)
  // wins over the value embedded at fetch time.
  const resolve = useCallback(
    (ev: PortalEvent): { name: string | null; color: string | null } => {
      const o = overrides[ev.portal_id];
      return {
        name: o?.name ?? ev.portals?.name ?? null,
        color: (o ? o.color : ev.portals?.color) ?? null,
      };
    },
    [overrides],
  );

  // Bucket events by local day key for quick lookup while rendering the grid.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, PortalEvent[]>();
    for (const ev of events) {
      const key = dayKey(new Date(ev.start_time));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  // "Upcoming" = the next 5 events from now forward (includes later-today events).
  const upcoming = useMemo(
    () =>
      events
        .filter((e) => new Date(e.start_time).getTime() >= today.getTime())
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        .slice(0, 5),
    [events, today],
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

  const deleteEvent = async (ev: PortalEvent) => {
    if (!window.confirm(`Delete "${ev.title}"? This can't be undone.`)) return;
    setDeletingId(ev.id);
    const ok = await deletePortalEvent(ev.id);
    if (!ok) { setDeletingId(null); return; }
    setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    setDeletingId(null);
  };

  return (
    <div className="border rounded-xl p-4 bg-background">
      <div className="flex flex-col sm:flex-row lg:flex-col gap-4 lg:gap-3">
        {/* Month section (shrinks when the events sections sit beside it). */}
        <div className="w-full sm:w-1/2 lg:w-full flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">
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
              <div key={w} className="text-[10px] font-medium text-muted-foreground uppercase py-1">
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
                  const manage = canManage(ev.portal_id);
                  return (
                    <EventCard
                      key={ev.id}
                      ev={ev}
                      name={name}
                      color={color}
                      onEdit={manage ? () => openEdit(ev) : undefined}
                      onDelete={manage ? () => deleteEvent(ev) : undefined}
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

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editingEvent}
        portalId={portalId}
        portals={portalId ? undefined : manageablePortals}
        defaultDate={selectedKey}
        onSaved={handleSaved}
      />
    </div>
  );
}
