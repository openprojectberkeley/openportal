"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, ClipboardCheck } from "lucide-react";
import { EventListSkeleton } from "@/components/skeletons";
import { accentSheen, hoverForeground, DEFAULT_ACCENT } from "@/lib/portal-color";
import { dayKey, dateFromKey, MONTHS, WEEKDAYS_SHORT } from "@/lib/dates";
import { useRoleSim } from "@/components/role-simulation-provider";
import { CATEGORY_META, type EventCategory } from "@/lib/event-category";
import { usePortalMeta } from "@/components/portal-meta-provider";
import { EventFormDialog, deletePortalEvent } from "@/components/event-form-dialog";
import { PortalAttendanceModal } from "@/components/portal-attendance-modal";
import { EventCard } from "@/components/event-card";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { SubscribeMenu } from "@/components/calendar-subscribe-menu";
import { useCalendarEvents, type PortalEvent } from "@/lib/use-calendar-events";

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
          // solid shape instead of a rimmed box. The sheen runs left-to-right
          // rather than diagonally: only the PEEK strip is ever visible, so a
          // vertical component would clip to the gradient's lightest end.
          backgroundColor: color || DEFAULT_ACCENT,
          backgroundImage: accentSheen("accent", "to right"),
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
  const { isExec, isBoardOrExec } = useRoleSim();
  const { overrides } = usePortalMeta();

  const {
    events,
    visibleEvents,
    eventsByDay,
    presentCategories,
    categoryFilter,
    toggleCategory,
    clearCategoryFilter,
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
  } = useCalendarEvents({ portalId });

  // The hook is null-until-loaded; the panel's own branches still read as
  // "loading", so derive it rather than flashing an empty state on every mount.
  const loading = events === null;

  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedKey, setSelectedKey] = useState<string>(dayKey(today));
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Club-wide tools, dashboard only. The club calendar has no portal, so its
  // attendance sheet and its Google sync have no portal settings page to live
  // on — they belong here, next to the events they act on.
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  // The club attendance sheet opens for everyone: board/exec get the marking
  // grid, an ordinary member the read-only list of their own status (the same
  // split the portal sheet already makes, and the one RLS enforces — a member
  // can only select rows where user_id = auth.uid()).
  const showClubAttendance = !portalId;

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PortalEvent | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // An in-session portal settings save lands in `overrides` first, so the band
  // retints without a reload — same precedence resolve() uses for event tints.
  const bandName = portalId ? overrides[portalId]?.name ?? portalName : undefined;
  const bandColor = portalId
    ? (overrides[portalId] ? overrides[portalId].color : portalColor) ?? null
    : null;

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

  const handleSaved = (saved: PortalEvent) => {
    applySaved(saved);
    jumpTo(saved.start_time);
  };

  const deleteEvent = async (ev: PortalEvent) => {
    if (!window.confirm(`Delete "${ev.title}"? This can't be undone.`)) return;
    setDeletingId(ev.id);
    const ok = await deletePortalEvent(ev.id);
    if (!ok) { setDeletingId(null); return; }
    applyDeleted(ev.id);
    setDeletingId(null);
  };

  return (
    <PortalBackingCard name={bandName} color={bandColor}>
    <div className="border rounded-xl p-4 bg-background">
      {!portalId && <SubscribeMenu className="mb-3 w-full" />}

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
            {WEEKDAYS_SHORT.map((w) => (
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
            <MultiSelectFilter
              label="Type"
              className="w-full"
              options={presentCategories.map((c) => ({
                key: c,
                label: CATEGORY_META[c].label,
                color: CATEGORY_META[c].color,
              }))}
              selected={categoryFilter}
              onToggle={(k) => toggleCategory(k as EventCategory)}
              onClear={clearCategoryFilter}
            />
          )}
        </div>

        {/* Events sections: divider swaps between top (stacked) and left (split). */}
        <div className="w-full sm:flex-1 lg:w-full min-w-0 flex flex-col gap-4 border-t pt-3 sm:border-t-0 sm:pt-0 sm:border-l sm:pl-4 lg:border-l-0 lg:pl-0 lg:border-t lg:pt-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {dateFromKey(selectedKey).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
              </span>
              {canAdd && (
                <button onClick={openCreate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Plus size={13} /> Add event
                </button>
              )}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

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

      {showClubAttendance && (
        <div className="flex flex-col gap-1.5 border-t mt-3 pt-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAttendanceOpen(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ClipboardCheck size={13} /> {isBoardOrExec ? "Club attendance" : "My attendance"}
            </button>
            {isExec && (
              <button
                onClick={syncGoogleCalendar}
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

      {showClubAttendance && (
        <PortalAttendanceModal
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          canManage={isBoardOrExec}
          canEditEvents={isExec}
          // Exec see every member; PMs only the members of projects they PM.
          fullAccess={isExec}
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
