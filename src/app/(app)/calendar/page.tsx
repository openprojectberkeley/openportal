"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarPageSkeleton, EventListSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarMonthGrid } from "@/components/calendar-month-grid";
import { CalendarWeekGrid } from "@/components/calendar-week-grid";
import { CalendarAgenda } from "@/components/calendar-agenda";
import { EventCard } from "@/components/event-card";
import { SubscribeMenu } from "@/components/calendar-subscribe-menu";
import { EventFormDialog, deletePortalEvent } from "@/components/event-form-dialog";
import { PortalAttendanceModal } from "@/components/portal-attendance-modal";
import { useRoleSim } from "@/components/role-simulation-provider";
import { CATEGORY_META, type EventCategory } from "@/lib/event-category";
import { useCalendarEvents, type PortalEvent } from "@/lib/use-calendar-events";
import { DEFAULT_ACCENT } from "@/lib/portal-color";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import {
  addDays,
  dateFromKey,
  dayKey,
  monthMatrix,
  MONTHS,
  parseLocalDate,
  startOfDay,
  startOfWeek,
  weekDays,
} from "@/lib/dates";
import { cn } from "@/lib/utils";

const VIEWS = ["month", "week", "agenda"] as const;
type CalendarViewName = (typeof VIEWS)[number];

/** How many days forward the agenda window runs. */
const AGENDA_DAYS = 60;

const PREV_LABEL: Record<CalendarViewName, string> = {
  month: "Previous month",
  week: "Previous week",
  agenda: "Earlier",
};
const NEXT_LABEL: Record<CalendarViewName, string> = {
  month: "Next month",
  week: "Next week",
  agenda: "Later",
};

/**
 * useSearchParams() reads uncached request data, and `cacheComponents` requires
 * that to sit inside a Suspense boundary so the page shell can still prerender
 * — the same reason portals/[id] wraps its useParams() read.
 */
export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarPageSkeleton />}>
      <CalendarPageBody />
    </Suspense>
  );
}

function CalendarPageBody() {
  const params = useSearchParams();
  const router = useRouter();
  const { isExec, isBoardOrExec } = useRoleSim();

  const {
    events,
    eventsByDay,
    presentCategories,
    categoryFilter,
    toggleCategory,
    clearCategoryFilter,
    presentPortals,
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
  } = useCalendarEvents();

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<PortalEvent | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);

  const view: CalendarViewName = (VIEWS as readonly string[]).includes(params.get("view") ?? "")
    ? (params.get("view") as CalendarViewName)
    : "month";

  // One piece of state for both the displayed period and the selected day: the
  // month/week/window shown is the one containing the anchor. Validated, because
  // an Invalid Date here would render 42 "NaN" cells instead of today.
  const anchor = useMemo(
    () => parseLocalDate(params.get("date") ?? "") ?? startOfDay(new Date()),
    [params],
  );
  const selectedKey = dayKey(anchor);
  const todayKey = useMemo(() => dayKey(new Date()), []);

  // push for the view switcher, replace for stepping through time: switching to
  // Week is a destination Back should undo, while clicking "next month" eight
  // times must not bury the Back button under eight history entries.
  const go = useCallback(
    (next: { view?: CalendarViewName; date?: Date }, mode: "push" | "replace") => {
      const sp = new URLSearchParams(params.toString());
      if (next.view) sp.set("view", next.view);
      if (next.date) sp.set("date", dayKey(next.date));
      router[mode](`/calendar?${sp}`, { scroll: false });
    },
    [params, router],
  );

  const selectDay = useCallback((key: string) => go({ date: dateFromKey(key) }, "replace"), [go]);

  const step = (dir: 1 | -1) => {
    const next =
      view === "month"
        ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
        : view === "week"
          ? addDays(anchor, dir * 7)
          : addDays(anchor, dir * AGENDA_DAYS);
    go({ date: next }, "replace");
  };

  const cells = useMemo(
    () => monthMatrix(anchor.getFullYear(), anchor.getMonth()),
    [anchor],
  );
  const days = useMemo(() => weekDays(anchor), [anchor]);

  const periodLabel = useMemo(() => {
    if (view === "month") return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    if (view === "week") {
      const start = startOfWeek(anchor);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const startLabel = start.toLocaleDateString([], { month: "short", day: "numeric" });
      const endLabel = end.toLocaleDateString([],
        sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
      return `${startLabel} – ${endLabel}, ${end.getFullYear()}`;
    }
    const end = addDays(anchor, AGENDA_DAYS - 1);
    return `${anchor.toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
  }, [view, anchor]);

  const selectedEvents = eventsByDay.get(selectedKey) ?? [];
  const loading = events === null;

  const openCreate = () => {
    setEditingEvent(null);
    setFormOpen(true);
  };
  const openEdit = (ev: PortalEvent) => {
    setEditingEvent(ev);
    setFormOpen(true);
  };

  // Clicking a chip or a week block selects the day it was clicked in: the
  // detail rail right below then shows the full card, with its edit/delete/ICS
  // controls. The cell's own key, not the event's start day — a multi-day
  // event's chip on its last day should select that day, not jump backwards.
  const openEvent = (_ev: PortalEvent, key: string) => selectDay(key);

  const handleSaved = (saved: PortalEvent) => {
    applySaved(saved);
    go({ date: new Date(saved.start_time) }, "replace");
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
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          <SubscribeMenu />
          {canAdd && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} /> Add event
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => go({ date: new Date() }, "replace")}
            className="rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Today
          </button>
          <button
            onClick={() => step(-1)}
            aria-label={PREV_LABEL[view]}
            className="p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => step(1)}
            aria-label={NEXT_LABEL[view]}
            className="p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight size={16} />
          </button>
          <h2 className="ml-1 select-none text-sm font-semibold">{periodLabel}</h2>
        </div>

        {/* Plain aria-pressed buttons in a labelled group, not role="tablist":
            a tablist with no tabpanels and no arrow-key handling is a half-built
            ARIA pattern, which reads worse than no roles at all. */}
        <div
          role="group"
          aria-label="Calendar view"
          className="inline-flex items-center gap-0.5 rounded-lg border p-0.5"
        >
          {VIEWS.map((v) => {
            const active = v === view;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={active}
                onClick={() => go({ view: v }, "push")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {/* Both dimensions, side by side. Each trigger carries its own label, so
          the pair needs no headings. They AND together. */}
      {(presentCategories.length > 1 || presentPortals.length > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          {presentCategories.length > 1 && (
            <MultiSelectFilter
              label="Type"
              className="w-44"
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
          {presentPortals.length > 1 && (
            <MultiSelectFilter
              label="Portal"
              className="w-52"
              options={presentPortals.map((o) => ({
                key: o.key,
                label: o.name,
                // Colourless portals still get a swatch slot, so the list
                // doesn't jump between indented and not.
                color: o.color ?? DEFAULT_ACCENT,
              }))}
              selected={portalFilter}
              onToggle={togglePortal}
              onClear={clearPortalFilter}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <CalendarBodySkeleton />
      ) : view === "agenda" ? (
        <CalendarAgenda
          eventsByDay={eventsByDay}
          from={anchor}
          days={AGENDA_DAYS}
          todayKey={todayKey}
          resolve={resolve}
          canManageEvent={canManageEvent}
          onEdit={openEdit}
          onDelete={deleteEvent}
          deletingId={deletingId}
        />
      ) : (
        <>
          {view === "month" ? (
            <CalendarMonthGrid
              cells={cells}
              month={anchor.getMonth()}
              eventsByDay={eventsByDay}
              selectedKey={selectedKey}
              todayKey={todayKey}
              resolve={resolve}
              onSelectDay={selectDay}
              onOpenEvent={openEvent}
            />
          ) : (
            <CalendarWeekGrid
              days={days}
              eventsByDay={eventsByDay}
              selectedKey={selectedKey}
              todayKey={todayKey}
              resolve={resolve}
              onSelectDay={selectDay}
              onOpenEvent={openEvent}
            />
          )}

          {/* Day detail rail, under both the month and the week grid. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {dateFromKey(selectedKey).toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h2>
              {canAdd && (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus size={13} /> Add event
                </button>
              )}
            </div>
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
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
                      // A synced row just resurrects on the next sync, minus its
                      // attendance — remove it in Google instead.
                      onDelete={manage && !ev.external_source ? () => deleteEvent(ev) : undefined}
                      deleting={deletingId === ev.id}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Club-wide tools. The club calendar has no portal, so its attendance
          sheet and its Google sync have no portal settings page to live on.
          The sheet is open to all; the sync stays exec-only. */}
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAttendanceOpen(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ClipboardCheck size={13} /> {isBoardOrExec ? "Club attendance" : "My attendance"}
          </button>
          {isExec && (
            <button
              onClick={syncGoogleCalendar}
              disabled={syncing}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : undefined} />
              {syncing ? "Syncing..." : "Sync Google Calendar"}
            </button>
          )}
        </div>
        {syncResult && <p className="text-[11px] text-muted-foreground">{syncResult}</p>}
      </div>

      {/* Open to everyone: board/exec get the marking grid, an ordinary member
          the read-only list of their own status. RLS enforces the same split. */}
      <PortalAttendanceModal
        open={attendanceOpen}
        onOpenChange={setAttendanceOpen}
        canManage={isBoardOrExec}
        canEditEvents={isExec}
        // Exec see every member; PMs only the members of projects they PM.
        fullAccess={isExec}
      />

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editingEvent}
        // No portalId: /calendar is the aggregate view, so the dialog offers the
        // portal picker (plus the club-wide option for exec).
        portals={manageablePortals}
        allowClubEvent={isExec}
        defaultDate={selectedKey}
        onSaved={handleSaved}
      />
    </div>
  );
}

// The grid area only — the toolbar above it is already interactive by then.
function CalendarBodySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-7 gap-px rounded-xl border p-px">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={`w${i}`} className="h-6 rounded-sm" />
        ))}
        {Array.from({ length: 42 }, (_, i) => (
          <Skeleton key={`d${i}`} className="h-[6.5rem] rounded-sm sm:h-[7.5rem]" />
        ))}
      </div>
      <EventListSkeleton count={2} />
    </div>
  );
}
