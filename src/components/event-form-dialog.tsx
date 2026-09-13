"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  ATTENDANCE_BY_DEFAULT,
  CATEGORY_META,
  EVENT_CATEGORIES,
  isEventCategory,
  isRoleGated,
  type EventCategory,
} from "@/lib/event-category";

// The shape a saved event round-trips as. Superset used by every caller: the
// calendar needs the `portals(name, color)` embed for tinting; the attendance
// grid ignores it. Matches calendar-panel's PortalEvent structurally.
export type EventFormValue = {
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

export const EVENT_FORM_SELECT =
  "id, portal_id, title, description, location, start_time, end_time, all_day, " +
  "category, attendance_enabled, category_overridden, external_source, external_link, cancelled_at, " +
  "portals(name, color)";

type PortalOption = { id: string; name: string };

// Sentinel for the portal picker's club-wide choice — <select> values are
// strings, so null needs a stand-in.
export const CLUB_EVENT_OPTION = "__club__";

// Local HH:mm for an ISO timestamp (prefills the time inputs on edit).
function timeValue(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Local YYYY-MM-DD for a Date (default date for a new event).
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Fields = {
  title: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  portalId: string;
  category: EventCategory;
  attendanceEnabled: boolean;
};

function blankFields(
  portalId: string | undefined,
  portals: PortalOption[] | undefined,
  defaultDate: string | undefined,
  defaultAttendance?: boolean,
): Fields {
  return {
    title: "",
    date: defaultDate ?? dayKey(new Date()),
    allDay: false,
    startTime: "18:00",
    endTime: "",
    location: "",
    description: "",
    portalId: portalId ?? portals?.[0]?.id ?? "",
    category: "general",
    attendanceEnabled: defaultAttendance ?? ATTENDANCE_BY_DEFAULT.general,
  };
}

function fromEvent(event: EventFormValue): Fields {
  return {
    title: event.title,
    date: dayKey(new Date(event.start_time)),
    allDay: event.all_day,
    startTime: event.all_day ? "18:00" : timeValue(event.start_time),
    endTime: event.end_time ? timeValue(event.end_time) : "",
    location: event.location ?? "",
    description: event.description ?? "",
    portalId: event.portal_id ?? CLUB_EVENT_OPTION,
    category: isEventCategory(event.category) ? event.category : "general",
    attendanceEnabled: event.attendance_enabled,
  };
}

type FieldsProps = {
  /** The event being edited. Null/undefined = creating a new event. */
  event?: EventFormValue | null;
  /** Fixed portal for new events (no picker shown). */
  portalId?: string;
  /** Portals to choose from for new events when `portalId` isn't fixed (aggregate view). */
  portals?: PortalOption[];
  /**
   * Offer "Club-wide" in the portal picker. Exec only — a club event has no
   * portal, so RLS gates it on is_exec() rather than portal admin (0095).
   */
  allowClubEvent?: boolean;
  /**
   * Create this event as a club event outright (no picker). Used by the
   * club attendance sheet, where every event is club-wide by definition.
   */
  clubEvent?: boolean;
  /** Default date (YYYY-MM-DD) for a new event; defaults to today. */
  defaultDate?: string;
  /**
   * Attendance toggle for a NEW event, overriding the category default. The
   * attendance modal passes true: an event created from there that didn't show
   * up in the grid would be a dead end.
   */
  defaultAttendance?: boolean;
  /** Called with the saved row after a successful insert/update. */
  onSaved: (ev: EventFormValue) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
};

// The add/edit event form body — inputs + save logic, with NO dialog wrapper.
// State initializes on mount, so callers that only mount it while visible get a
// fresh form each time. Reused by EventFormDialog (calendar panel) and rendered
// inline inside the attendance modal (avoids stacking two Radix dialogs).
export function EventFormFields({ event, portalId, portals, allowClubEvent, clubEvent, defaultDate, defaultAttendance, onSaved, onCancel }: FieldsProps) {
  const editing = Boolean(event);
  // Synced events mirror Google Calendar: their title/time/place are owned
  // there and would be overwritten on the next sync, so only the fields this
  // app owns — category and attendance — stay editable.
  const isSynced = Boolean(event?.external_source);
  const [fields, setFields] = useState<Fields>(() =>
    event
      ? fromEvent(event)
      : blankFields(clubEvent ? CLUB_EVENT_OPTION : portalId, portals, defaultDate, defaultAttendance),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showPortalPicker =
    !editing && !portalId && !clubEvent && ((portals?.length ?? 0) > 0 || Boolean(allowClubEvent));

  const save = async () => {
    const title = fields.title.trim();
    if (!title) { setError("Title is required."); return; }
    if (!fields.date) { setError("Date is required."); return; }
    if (!editing && !fields.portalId) { setError("Pick a portal."); return; }
    const newPortalId = fields.portalId === CLUB_EVENT_OPTION ? null : fields.portalId;

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); setSaving(false); return; }

    let start_time: string;
    let end_time: string | null = null;
    if (fields.allDay) {
      start_time = new Date(`${fields.date}T00:00`).toISOString();
    } else {
      start_time = new Date(`${fields.date}T${fields.startTime || "00:00"}`).toISOString();
      if (fields.endTime) end_time = new Date(`${fields.date}T${fields.endTime}`).toISOString();
    }

    const categoryChanged = editing && event!.category !== fields.category;

    const payload = {
      title,
      description: fields.description.trim() || null,
      location: fields.location.trim() || null,
      start_time,
      end_time,
      all_day: fields.allDay,
      category: fields.category,
      attendance_enabled: fields.attendanceEnabled,
      // Once someone picks a category by hand it's theirs: the calendar sync
      // skips the title-matching rules for this row from then on.
      ...(categoryChanged ? { category_overridden: true } : {}),
    };

    // portal_events has no updated_at trigger, so set it manually on edits.
    // Editing keeps the event's own portal; creation uses the picked/fixed one.
    // For a synced row, narrow the update to the app-owned columns.
    const updatePayload = isSynced
      ? {
          category: payload.category,
          attendance_enabled: payload.attendance_enabled,
          ...(categoryChanged ? { category_overridden: true } : {}),
        }
      : payload;

    const query = editing
      ? supabase
          .from("portal_events")
          .update({ ...updatePayload, updated_at: new Date().toISOString() })
          .eq("id", event!.id)
      : supabase
          .from("portal_events")
          .insert({ ...payload, portal_id: newPortalId, created_by: user.id });

    const { data, error: saveError } = await query.select(EVENT_FORM_SELECT).single();

    if (saveError) { setError(saveError.message); setSaving(false); return; }

    onSaved(data as unknown as EventFormValue);
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {isSynced && (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-2.5 py-2">
          Synced from Google Calendar. Title, time and location are edited there
          {event?.external_link && (
            <>
              {" — "}
              <a
                href={event.external_link}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                open in Google Calendar
              </a>
            </>
          )}
          . Category and attendance are set here.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-form-title">Title</Label>
        <Input
          id="event-form-title"
          value={fields.title}
          disabled={isSynced}
          onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
        />
      </div>
      {showPortalPicker && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="event-form-portal">Portal</Label>
          <select
            id="event-form-portal"
            value={fields.portalId}
            onChange={(e) => setFields((f) => ({ ...f, portalId: e.target.value }))}
            className="border rounded-md h-9 px-3 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {allowClubEvent && (
              <option value={CLUB_EVENT_OPTION}>Club-wide (no portal)</option>
            )}
            {(portals ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-form-date">Date</Label>
        <Input
          id="event-form-date"
          type="date"
          value={fields.date}
          disabled={isSynced}
          onChange={(e) => setFields((f) => ({ ...f, date: e.target.value }))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={fields.allDay}
          disabled={isSynced}
          onCheckedChange={(v) => setFields((f) => ({ ...f, allDay: v === true }))}
        />
        All day
      </label>
      {!fields.allDay && (
        <div className="flex gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <Label htmlFor="event-form-start">Start</Label>
            <Input
              id="event-form-start"
              type="time"
              value={fields.startTime}
              disabled={isSynced}
              onChange={(e) => setFields((f) => ({ ...f, startTime: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <Label htmlFor="event-form-end">End</Label>
            <Input
              id="event-form-end"
              type="time"
              value={fields.endTime}
              disabled={isSynced}
              onChange={(e) => setFields((f) => ({ ...f, endTime: e.target.value }))}
              placeholder="Optional"
            />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-form-location">Location</Label>
        <Input
          id="event-form-location"
          value={fields.location}
          disabled={isSynced}
          onChange={(e) => setFields((f) => ({ ...f, location: e.target.value }))}
          placeholder="Optional"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-form-description">Description</Label>
        <textarea
          id="event-form-description"
          value={fields.description}
          disabled={isSynced}
          onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
          rows={3}
          className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-form-category">Category</Label>
        <select
          id="event-form-category"
          value={fields.category}
          onChange={(e) => {
            const category = isEventCategory(e.target.value) ? e.target.value : "general";
            // Changing the kind of event re-applies that kind's attendance
            // default, which is almost always what's wanted; the switch below
            // is still there to override it.
            setFields((f) => ({
              ...f,
              category,
              // Keep an explicitly requested default (the attendance modal) on.
              attendanceEnabled: defaultAttendance ?? ATTENDANCE_BY_DEFAULT[category],
            }));
          }}
          className="border rounded-md h-9 px-3 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {EVENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_META[c].label}</option>
          ))}
        </select>
        {isRoleGated(fields.category) && (
          <p className="text-xs text-muted-foreground">
            Visible only to board and exec, whatever portal it&apos;s in.
          </p>
        )}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex flex-col">
          Take attendance
          <span className="text-xs text-muted-foreground">Show this event in the attendance sheet.</span>
        </span>
        <Switch
          checked={fields.attendanceEnabled}
          onCheckedChange={(v) => setFields((f) => ({ ...f, attendanceEnabled: v }))}
        />
      </label>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
      </div>
    </div>
  );
}

type DialogProps = Omit<FieldsProps, "onCancel"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Add/edit an event in a standalone dialog (used by the calendar panel). Content
// only mounts while open, so EventFormFields resets each time it's shown.
export function EventFormDialog({ open, onOpenChange, event, portalId, portals, allowClubEvent, clubEvent, defaultDate, defaultAttendance, onSaved }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <EventFormFields
          event={event}
          portalId={portalId}
          portals={portals}
          allowClubEvent={allowClubEvent}
          clubEvent={clubEvent}
          defaultDate={defaultDate}
          defaultAttendance={defaultAttendance}
          onSaved={(ev) => { onSaved(ev); onOpenChange(false); }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Delete an event. Returns true on success. Caller handles confirmation + UI. */
export async function deletePortalEvent(eventId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.from("portal_events").delete().eq("id", eventId);
  return !error;
}
