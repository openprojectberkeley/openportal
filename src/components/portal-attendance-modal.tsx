"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
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

// projectIds: the projects this person is on, for the club sheet's project
// filter. Empty on a portal sheet, whose roster is already the portal's.
type RosterRow = { user_id: string; name: string; projectIds: string[] };

type ProjectOption = { id: string; name: string };

// attendance keyed by `${event_id}:${user_id}` -> status, for O(1) lookups while
// rendering the grid and updating optimistically.
type AttendanceMap = Record<string, Status>;

type Props = {
  /** Omit for the club-wide sheet: events with no portal, roster = active members. */
  portalId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  /**
   * Whether the viewer may add/edit/delete the events themselves, as opposed to
   * only marking attendance. Defaults to `canManage`. The club sheet passes
   * exec-only here: board and PMs take attendance at club events, but only
   * exec creates or retags one (migration 0095).
   */
  canEditEvents?: boolean;
  /**
   * Club sheet only: whether the roster is every active member (exec) or just
   * the members of the projects the viewer PMs. Either way a dropdown narrows
   * it to one project.
   */
  fullAccess?: boolean;
};

const selectClass =
  "h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-xs text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
  imported,
  onEdit,
  onDelete,
  onRemove,
}: {
  ev: EventFormValue;
  /** A club event pinned into this portal's sheet (migration 0102). */
  imported?: boolean;
  /** Omitted when the viewer may mark attendance but not change the event. */
  onEdit?: () => void;
  onDelete?: () => void;
  /** Un-imports a club event; its attendance is kept. */
  onRemove?: () => void;
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
          {imported && <span className="ml-1 rounded bg-foreground/10 px-1 normal-case tracking-normal">Club</span>}
        </span>
        <span ref={titleRef} className="truncate max-w-[8rem]" title={ev.title}>
          {ev.title}
        </span>
      </div>

      {/* Edit / delete, revealed top-right on hover. */}
      {(onEdit || onDelete || onRemove) && (
        <div className="absolute top-1 right-1 z-50 hidden items-center gap-0.5 group-hover/evt:flex">
          {onEdit && (
            <button
              onClick={onEdit}
              aria-label={`Edit ${ev.title}`}
              title="Edit event"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Pencil size={12} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              aria-label={`Delete ${ev.title}`}
              title="Delete event"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-red-500"
            >
              <Trash2 size={12} />
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              aria-label={`Remove ${ev.title} from this sheet`}
              title="Remove from this sheet (attendance is kept)"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

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

// Attendance for a portal's events, or — with `portalId` omitted — for the
// club-wide events that belong to no portal (migration 0095). Managers get a
// members × events grid and mark each cell present/absent/excused; ordinary
// members see a read-only list of their own attendance. RLS enforces the same
// split, via can_take_event_attendance().
export function PortalAttendanceModal({
  portalId,
  open,
  onOpenChange,
  canManage,
  canEditEvents,
  fullAccess = false,
}: Props) {
  const canEdit = canEditEvents ?? canManage;
  const [events, setEvents] = useState<EventFormValue[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceMap>({});
  const [loading, setLoading] = useState(true);

  // Club events pinned into this portal's sheet (0102). Portal sheet only.
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const canImport = canManage && !!portalId;

  // Club sheet project filter. "" = everyone the viewer has access to.
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectFilter, setProjectFilter] = useState("");

  // Event form (admins only). editingEvent null = creating a new event.
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventFormValue | null>(null);

  // Import picker (portal admins only), rendered inline like the form.
  const [importOpen, setImportOpen] = useState(false);
  const [clubEvents, setClubEvents] = useState<EventFormValue[] | null>(null);
  const [importSearch, setImportSearch] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    setLoading(true);
    setProjectFilter("");
    setImportOpen(false);

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();

      // Admins get a chronological grid (oldest → newest across columns);
      // members get a most-recent-first list.
      const eventQuery = supabase.from("portal_events").select(EVENT_FORM_SELECT);
      const [{ data: eventRows }, { data: importRows }] = await Promise.all([
        (portalId ? eventQuery.eq("portal_id", portalId) : eventQuery.is("portal_id", null))
          // Only events that opted in — socials and info sessions would otherwise
          // pad the grid with columns nobody ever marks.
          .eq("attendance_enabled", true)
          .is("cancelled_at", null),
        portalId
          ? supabase.from("portal_imported_events").select("event_id").eq("portal_id", portalId)
          : Promise.resolve({ data: [] as { event_id: string }[] }),
      ]);

      // Imported club events join the portal's own. They were picked by hand,
      // so they show regardless of attendance_enabled.
      const imported = new Set(((importRows ?? []) as { event_id: string }[]).map((r) => r.event_id));
      const { data: importedEventRows } = imported.size
        ? await supabase
            .from("portal_events")
            .select(EVENT_FORM_SELECT)
            .in("id", [...imported])
            .is("cancelled_at", null)
        : { data: [] as unknown[] };

      const evs = [...(eventRows ?? []), ...(importedEventRows ?? [])] as unknown as EventFormValue[];
      evs.sort(canManage ? byStart : (a, b) => byStart(b, a));
      const eventIds = evs.map((e) => e.id);

      // Roster (admins only — members don't need other people's names).
      // A portal sheet uses the portal roster. The club sheet has none: exec
      // get every active member (you can't be marked absent from a club you
      // aren't in), everyone else the members of the projects they PM.
      type ProjectMemberRow = {
        user_id: string;
        project_id: string;
        members?: { preferred_firstname: string | null; lastname: string | null } | null;
      };
      let projectOptions: ProjectOption[] = [];
      let projectMembers: ProjectMemberRow[] = [];
      let rosterPromise: PromiseLike<{ data: unknown[] | null }> = Promise.resolve({ data: [] });

      if (canManage && portalId) {
        rosterPromise = supabase
          .from("portal_members")
          .select("user_id, members(preferred_firstname, lastname)")
          .eq("portal_id", portalId);
      } else if (canManage && fullAccess) {
        rosterPromise = supabase
          .from("members")
          .select("user_id, preferred_firstname, lastname")
          .eq("status", "active");
        const [{ data: projectRows }, { data: pmRows }] = await Promise.all([
          supabase.from("projects").select("id, name").order("name"),
          supabase.from("project_members").select("user_id, project_id"),
        ]);
        projectOptions = (projectRows ?? []) as ProjectOption[];
        projectMembers = (pmRows ?? []) as ProjectMemberRow[];
      } else if (canManage && user) {
        const { data: myRows } = await supabase
          .from("project_members")
          .select("project_id, projects(name)")
          .eq("user_id", user.id)
          .eq("is_pm", true);
        // `projects(name)` is a to-one embed (object at runtime).
        projectOptions = ((myRows ?? []) as unknown as { project_id: string; projects: { name: string } | null }[])
          .map((r) => ({ id: r.project_id, name: r.projects?.name ?? "Untitled project" }))
          .sort(byName);
        if (projectOptions.length) {
          const { data: pmRows } = await supabase
            .from("project_members")
            .select("user_id, project_id, members(preferred_firstname, lastname)")
            .in("project_id", projectOptions.map((p) => p.id));
          projectMembers = (pmRows ?? []) as unknown as ProjectMemberRow[];
        }
        // One row per person, however many of the viewer's projects they're on.
        const seen = new Set<string>();
        rosterPromise = Promise.resolve({
          data: projectMembers.filter((r) => !seen.has(r.user_id) && seen.add(r.user_id)),
        });
      }

      const projectsByUser = new Map<string, string[]>();
      for (const r of projectMembers) {
        projectsByUser.set(r.user_id, [...(projectsByUser.get(r.user_id) ?? []), r.project_id]);
      }
      setProjects(projectOptions);
      setImportedIds(imported);

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

      // Two row shapes: the portal roster nests the member under `members`,
      // while the club roster reads the members table directly and is flat.
      type RosterSource = {
        user_id: string;
        members?: { preferred_firstname: string | null; lastname: string | null } | null;
        preferred_firstname?: string | null;
        lastname?: string | null;
      };
      setRoster(
        ((rosterRows ?? []) as RosterSource[])
          .map((row) => {
            const m = row.members ?? row;
            return {
              user_id: row.user_id,
              name: fullName(m.preferred_firstname, m.lastname),
              projectIds: projectsByUser.get(row.user_id) ?? [],
            };
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
  }, [open, portalId, canManage, fullAccess]);

  const visibleRoster = useMemo(
    () => (projectFilter ? roster.filter((r) => r.projectIds.includes(projectFilter)) : roster),
    [roster, projectFilter],
  );

  const openImport = async () => {
    setImportSearch("");
    setImportOpen(true);
    setClubEvents(null);
    const { data } = await createClient()
      .from("portal_events")
      .select(EVENT_FORM_SELECT)
      .is("portal_id", null)
      .is("cancelled_at", null)
      // Board-only events can't be imported (0102): the portal's members
      // couldn't see them.
      .neq("category", "board")
      .order("start_time", { ascending: false });
    setClubEvents((data ?? []) as unknown as EventFormValue[]);
  };

  const importEvent = async (ev: EventFormValue) => {
    if (!portalId) return;
    setImportingId(ev.id);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = user
      ? await supabase
          .from("portal_imported_events")
          .insert({ portal_id: portalId, event_id: ev.id, imported_by: user.id })
      : { error: true };
    setImportingId(null);
    if (error) return;
    setImportedIds((prev) => new Set(prev).add(ev.id));
    setEvents((prev) => [...prev, ev].sort(byStart));

    // Pull in any marks already made from the club sheet.
    const { data: rows } = await supabase
      .from("portal_event_attendance")
      .select("event_id, user_id, status")
      .eq("event_id", ev.id);
    setAttendance((prev) => {
      const next = { ...prev };
      for (const row of (rows ?? []) as { event_id: string; user_id: string; status: Status }[]) {
        next[key(row.event_id, row.user_id)] = row.status;
      }
      return next;
    });
  };

  const removeImport = async (ev: EventFormValue) => {
    if (!portalId) return;
    if (!window.confirm(`Remove "${ev.title}" from this sheet? Attendance already taken is kept.`)) return;
    const { error } = await createClient()
      .from("portal_imported_events")
      .delete()
      .eq("portal_id", portalId)
      .eq("event_id", ev.id);
    if (error) return;
    setImportedIds((prev) => {
      const next = new Set(prev);
      next.delete(ev.id);
      return next;
    });
    setEvents((prev) => prev.filter((e) => e.id !== ev.id));
  };

  const importable = (clubEvents ?? []).filter(
    (ev) =>
      !importedIds.has(ev.id) &&
      ev.title.toLowerCase().includes(importSearch.trim().toLowerCase()),
  );

  const setStatus = async (eventId: string, userId: string, status: Status) => {
    const k = key(eventId, userId);
    const prev = attendance[k];
    // Clicking the already-selected status clears it back to the empty state.
    const clearing = prev === status;

    const rollback = () =>
      setAttendance((m) => {
        const next = { ...m };
        if (prev === undefined) delete next[k];
        else next[k] = prev;
        return next;
      });

    // Optimistic: update the map first, roll back on error.
    setAttendance((m) => {
      const next = { ...m };
      if (clearing) delete next[k];
      else next[k] = status;
      return next;
    });

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { rollback(); return; }

    const { error } = clearing
      ? await supabase
          .from("portal_event_attendance")
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", userId)
      : await supabase
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

    if (error) rollback();
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
    setEvents((prev) => {
      // This grid only lists events with attendance on, so toggling it off in
      // the form means the event leaves the grid rather than updating in place.
      if (!saved.attendance_enabled) return prev.filter((e) => e.id !== saved.id);
      const next = prev.some((e) => e.id === saved.id)
        ? prev.map((e) => (e.id === saved.id ? saved : e))
        : [...prev, saved];
      return next.sort(byStart);
    });
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
            ) : importOpen ? (
              "Import club event"
            ) : (
              <>
                Attendance
                {canManage && !loading && events.length > 0 && (
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground/60">
                    ({visibleRoster.length} {visibleRoster.length === 1 ? "member" : "members"} · {events.length}{" "}
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
                clubEvent={!portalId}
                defaultAttendance
                onSaved={(ev) => { handleSaved(ev); setFormOpen(false); }}
                onCancel={() => setFormOpen(false)}
              />
            </div>
          </ScrollArea>
        ) : importOpen ? (
          // Club events (GMs etc.) to pin into this portal's sheet. Marks made
          // here and on the club sheet are the same attendance rows.
          <div className="flex flex-col min-h-0 flex-1 gap-2">
            <div className="flex-shrink-0 flex items-center gap-2">
              <Input
                autoFocus
                placeholder="Search club events"
                value={importSearch}
                onChange={(e) => setImportSearch(e.target.value)}
                className="h-8"
              />
              <Button size="sm" variant="outline" onClick={() => setImportOpen(false)}>
                Done
              </Button>
            </div>
            {clubEvents === null ? (
              <MemberRosterSkeleton />
            ) : importable.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No club events to import.</p>
            ) : (
              <ScrollArea className="flex-1 min-h-0">
                <div className="flex flex-col gap-1">
                  {importable.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 text-sm py-1.5 border-b last:border-0">
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate">{ev.title}</span>
                        <span className="text-xs text-muted-foreground">{formatEventDate(ev.start_time)}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={importingId === ev.id}
                        onClick={() => importEvent(ev)}
                      >
                        {importingId === ev.id ? "Importing..." : "Import"}
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        ) : loading ? (
          <MemberRosterSkeleton />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-sm text-muted-foreground">
              {canManage ? "No events to take attendance for yet." : "No attendance has been taken yet."}
            </p>
            <div className="flex items-center gap-2">
              {canEdit && (
                <Button size="sm" variant="outline" onClick={openCreate}>
                  <Plus size={14} /> Add event
                </Button>
              )}
              {canImport && (
                <Button size="sm" variant="outline" onClick={openImport}>
                  <Download size={14} /> Import club event
                </Button>
              )}
            </div>
          </div>
        ) : canManage ? (
          <div className="flex flex-col min-h-0 flex-1 gap-2">
            {/* Legend for the single-letter status buttons, plus the club
                sheet's project filter and the portal sheet's import button. */}
            <div className="flex-shrink-0 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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
              <div className="ml-auto flex items-center gap-2">
                {!portalId && projects.length > 0 && (
                  <select
                    aria-label="Filter by project"
                    className={selectClass}
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                  >
                    <option value="">{fullAccess ? "All members" : "All my projects"}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {canImport && (
                  <Button size="sm" variant="outline" className="h-8" onClick={openImport}>
                    <Download size={14} /> Import club event
                  </Button>
                )}
              </div>
            </div>

            {visibleRoster.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {!portalId && !fullAccess && projects.length === 0
                  ? "You don't PM any projects."
                  : "No members yet."}
              </p>
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
                          imported={importedIds.has(ev.id)}
                          // An imported club event belongs to the club sheet:
                          // here it can only be un-imported, not edited.
                          onEdit={canEdit && !importedIds.has(ev.id) ? () => openEdit(ev) : undefined}
                          onDelete={canEdit && !importedIds.has(ev.id) ? () => deleteEvent(ev) : undefined}
                          onRemove={canImport && importedIds.has(ev.id) ? () => removeImport(ev) : undefined}
                        />
                      ))}
                      {/* Add-event column: a "+" to the right of the most recent event. */}
                      {canEdit && (
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
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRoster.map((r) => (
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
