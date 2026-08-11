"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { PersonName } from "@/components/person-profile-provider";
import { MemberRosterSkeleton } from "@/components/skeletons";
import {
  EventFormFields,
  deletePortalEvent,
  EVENT_FORM_SELECT,
  type EventFormValue,
} from "@/components/event-form-dialog";

type Status = "present" | "absent" | "excused";

type RosterRow = { user_id: string; name: string };

// attendance keyed by `${event_id}:${user_id}` -> status, for O(1) lookups while
// rendering the grid and updating optimistically.
type AttendanceMap = Record<string, Status>;

type Props = {
  portalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
};

const STATUSES: { value: Status; label: string; short: string }[] = [
  { value: "present", label: "Present", short: "P" },
  { value: "absent", label: "Absent", short: "A" },
  { value: "excused", label: "Excused", short: "E" },
];

const STATUS_LABEL: Record<Status, string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
};

// Selected/legend colors: present = green, absent = red, excused = yellow.
const STATUS_COLOR: Record<Status, string> = {
  present: "bg-green-500 text-white hover:bg-green-600",
  absent: "bg-red-500 text-white hover:bg-red-600",
  excused: "bg-yellow-400 text-black hover:bg-yellow-500",
};

const fullName = (first: string | null | undefined, last: string | null | undefined) =>
  [first, last].filter(Boolean).join(" ") || "—";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const byStart = (a: EventFormValue, b: EventFormValue) =>
  new Date(a.start_time).getTime() - new Date(b.start_time).getTime();

const key = (eventId: string, userId: string) => `${eventId}:${userId}`;

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// One event column header. Detects whether its title is actually truncated so the
// read-in-full hover overlay only appears when the text is cut off, and exposes
// edit/delete controls (top-right) on hover.
function EventHeaderCell({
  ev,
  onEdit,
  onDelete,
}: {
  ev: EventFormValue;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    window.addEventListener("resize", check);
    // Web-font swap can change text width after first paint; re-check once ready.
    document.fonts?.ready.then(check).catch(() => {});
    return () => window.removeEventListener("resize", check);
  }, [ev.title]);

  return (
    <th className="group/evt relative sticky top-0 z-20 bg-background border-b border-r px-2 py-2 text-left font-medium align-bottom min-w-[9rem]">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wide">
          {formatEventDate(ev.start_time)}
        </span>
        <span ref={titleRef} className="truncate max-w-[8rem]" title={ev.title}>
          {ev.title}
        </span>
      </div>

      {/* Edit / delete, revealed top-right on hover. */}
      <div className="absolute top-1 right-1 z-50 hidden items-center gap-0.5 group-hover/evt:flex">
        <button
          onClick={onEdit}
          aria-label={`Edit ${ev.title}`}
          title="Edit event"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={onDelete}
          aria-label={`Delete ${ev.title}`}
          title="Delete event"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-red-500"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Read-in-full overlay — only when the title is actually cut off. The same
          box, positioned over the cell but not truncated. */}
      {truncated && (
        <div className="pointer-events-none absolute left-0 top-0 z-40 hidden flex-col gap-0.5 whitespace-nowrap rounded-md border bg-popover px-2 py-2 shadow-lg group-hover/evt:flex">
          <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-wide">
            {formatEventDate(ev.start_time)}
          </span>
          <span className="pr-12 font-medium">{ev.title}</span>
        </div>
      )}
    </th>
  );
}

// Attendance for a portal's events. Portal admins get a members × events grid and
// mark each cell present/absent/excused; ordinary members see a read-only list of
// their own attendance across the portal's events. RLS enforces the same split.
export function PortalAttendanceModal({ portalId, open, onOpenChange, canManage }: Props) {
  const [events, setEvents] = useState<EventFormValue[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceMap>({});
  const [loading, setLoading] = useState(true);

  // Event form (admins only). editingEvent null = creating a new event.
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventFormValue | null>(null);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    setLoading(true);

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();

      // Admins get a chronological grid (oldest → newest across columns);
      // members get a most-recent-first list.
      const { data: eventRows } = await supabase
        .from("portal_events")
        .select(EVENT_FORM_SELECT)
        .eq("portal_id", portalId)
        .order("start_time", { ascending: canManage });

      const evs = (eventRows ?? []) as unknown as EventFormValue[];
      const eventIds = evs.map((e) => e.id);

      // Roster (admins only — members don't need other people's names).
      const rosterPromise = canManage
        ? supabase
            .from("portal_members")
            .select("user_id, members(preferred_firstname, lastname)")
            .eq("portal_id", portalId)
        : Promise.resolve({ data: [] as unknown[] });

      // Attendance rows. Admins get everything for the portal's events (RLS
      // permits it); members get only their own (RLS restricts it, the .eq is
      // belt-and-suspenders). Skip the query when there are no events.
      const attendancePromise = eventIds.length
        ? (() => {
            let q = supabase
              .from("portal_event_attendance")
              .select("event_id, user_id, status")
              .in("event_id", eventIds);
            if (!canManage && user) q = q.eq("user_id", user.id);
            return q;
          })()
        : Promise.resolve({ data: [] as unknown[] });

      const [{ data: rosterRows }, { data: attendanceRows }] = await Promise.all([
        rosterPromise,
        attendancePromise,
      ]);

      setEvents(evs);

      setRoster(
        ((rosterRows ?? []) as { user_id: string; members: unknown }[])
          .map((pm) => {
            const m = pm.members as { preferred_firstname: string | null; lastname: string | null } | null;
            return { user_id: pm.user_id, name: fullName(m?.preferred_firstname, m?.lastname) };
          })
          .sort(byName),
      );

      const map: AttendanceMap = {};
      for (const row of (attendanceRows ?? []) as { event_id: string; user_id: string; status: Status }[]) {
        map[key(row.event_id, row.user_id)] = row.status;
      }
      setAttendance(map);
      setLoading(false);
    })();
  }, [open, portalId, canManage]);

  const setStatus = async (eventId: string, userId: string, status: Status) => {
    const k = key(eventId, userId);
    const prev = attendance[k];
    if (prev === status) return;

    // Optimistic: update the map first, roll back on error.
    setAttendance((m) => ({ ...m, [k]: status }));

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("portal_event_attendance")
      .upsert(
        {
          event_id: eventId,
          user_id: userId,
          status,
          recorded_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,user_id" },
      );

    if (error) {
      setAttendance((m) => {
        const next = { ...m };
        if (prev === undefined) delete next[k];
        else next[k] = prev;
        return next;
      });
    }
  };

  const openCreate = () => {
    setEditingEvent(null);
    setFormOpen(true);
  };

  const openEdit = (ev: EventFormValue) => {
    setEditingEvent(ev);
    setFormOpen(true);
  };

  const handleSaved = (saved: EventFormValue) => {
    setEvents((prev) =>
      (prev.some((e) => e.id === saved.id) ? prev.map((e) => (e.id === saved.id ? saved : e)) : [...prev, saved]).sort(
        byStart,
      ),
    );
  };

  const deleteEvent = async (ev: EventFormValue) => {
    if (!window.confirm(`Delete "${ev.title}"? This can't be undone.`)) return;
    const ok = await deletePortalEvent(ev.id);
    if (!ok) return;
    setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    // Drop this event's attendance cells from the map.
    setAttendance((prev) => {
      const next: AttendanceMap = {};
      for (const [k, v] of Object.entries(prev)) if (!k.startsWith(`${ev.id}:`)) next[k] = v;
      return next;
    });
  };

  return (
    // Single dialog. The add/edit event form renders INLINE here (not as a second
    // stacked dialog), so closing it just swaps back to the grid and can never
    // dismiss this modal.
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Admins get a wide grid; members a compact list. Either way the modal is
          fixed-height and the content scrolls inside it. */}
      <DialogContent
        className={
          canManage
            ? "flex flex-col h-[85vh] w-[95vw] sm:max-w-5xl"
            : "flex flex-col h-[30rem] max-h-[85vh]"
        }
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {formOpen ? (
              editingEvent ? "Edit event" : "New event"
            ) : (
              <>
                Attendance
                {canManage && !loading && events.length > 0 && (
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground/60">
                    ({roster.length} {roster.length === 1 ? "member" : "members"} · {events.length}{" "}
                    {events.length === 1 ? "event" : "events"})
                  </span>
                )}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {formOpen ? (
          <ScrollArea className="flex-1 min-h-0">
            <div className="mx-auto w-full max-w-md py-2">
              <EventFormFields
                event={editingEvent}
                portalId={portalId}
                onSaved={(ev) => { handleSaved(ev); setFormOpen(false); }}
                onCancel={() => setFormOpen(false)}
              />
            </div>
          </ScrollArea>
        ) : loading ? (
          <MemberRosterSkeleton />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-sm text-muted-foreground">No events yet.</p>
            {canManage && (
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Plus size={14} /> Add event
              </Button>
            )}
          </div>
        ) : canManage ? (
          <div className="flex flex-col min-h-0 flex-1 gap-2">
            {/* Legend for the single-letter status buttons. */}
            <div className="flex-shrink-0 flex items-center gap-3 text-xs text-muted-foreground">
              {STATUSES.map((s) => (
                <span key={s.value} className="flex items-center gap-1">
                  <span
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium ${STATUS_COLOR[s.value]}`}
                  >
                    {s.short}
                  </span>
                  {s.label}
                </span>
              ))}
            </div>

            {roster.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No members yet.</p>
            ) : (
              <ScrollArea orientation="both" className="flex-1 min-h-0 border rounded-lg">
                {/* border-separate + per-cell borders so sticky header/first-column
                    cells keep their borders while scrolling. */}
                <table className="border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 bg-background border-b border-r px-3 py-2 text-left font-medium min-w-[10rem]">
                        Member
                      </th>
                      {events.map((ev) => (
                        <EventHeaderCell
                          key={ev.id}
                          ev={ev}
                          onEdit={() => openEdit(ev)}
                          onDelete={() => deleteEvent(ev)}
                        />
                      ))}
                      {/* Add-event column: a "+" to the right of the most recent event. */}
                      <th className="sticky top-0 z-20 bg-background border-b px-1 py-2 align-bottom w-12">
                        <button
                          onClick={openCreate}
                          aria-label="Add event"
                          title="Add event"
                          className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <Plus size={16} />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((r) => (
                      <tr key={r.user_id}>
                        <td className="sticky left-0 z-10 bg-background border-b border-r px-3 py-1.5 min-w-[10rem]">
                          <PersonName userId={r.user_id} name={r.name} className="block truncate" />
                        </td>
                        {events.map((ev) => {
                          const current = attendance[key(ev.id, r.user_id)];
                          return (
                            <td key={ev.id} className="border-b border-r px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                {STATUSES.map((s) => (
                                  <button
                                    key={s.value}
                                    onClick={() => setStatus(ev.id, r.user_id, s.value)}
                                    aria-pressed={current === s.value}
                                    title={s.label}
                                    aria-label={`${s.label} — ${r.name}`}
                                    className={`h-6 w-6 flex-shrink-0 rounded-full text-xs font-medium transition-colors ${
                                      current === s.value
                                        ? STATUS_COLOR[s.value]
                                        : "bg-foreground/10 text-foreground hover:bg-foreground/20"
                                    }`}
                                  >
                                    {s.short}
                                  </button>
                                ))}
                              </div>
                            </td>
                          );
                        })}
                        {/* Spacer cell under the add-event column. */}
                        <td className="border-b w-12" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </div>
        ) : (
          // Member view: read-only list of the member's own status per event.
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-1">
              {events.map((ev) => {
                // The member's own rows are the only ones loaded; the map is keyed
                // by event id (the user id is always the current user here).
                const own = Object.entries(attendance).find(([k]) => k.startsWith(`${ev.id}:`));
                const status = own?.[1];
                return (
                  <div key={ev.id} className="flex items-center gap-2 text-sm py-1.5 border-b last:border-0">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{ev.title}</span>
                      <span className="text-xs text-muted-foreground">{formatEventDate(ev.start_time)}</span>
                    </div>
                    {status ? (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${STATUS_COLOR[status]}`}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground flex-shrink-0">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
