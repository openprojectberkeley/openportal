"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

// The shape a saved event round-trips as. Superset used by every caller: the
// calendar needs the `portals(name, color)` embed for tinting; the attendance
// grid ignores it. Matches calendar-panel's PortalEvent structurally.
export type EventFormValue = {
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

export const EVENT_FORM_SELECT =
  "id, portal_id, title, description, location, start_time, end_time, all_day, portals(name, color)";

type PortalOption = { id: string; name: string };

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
};

function blankFields(
  portalId: string | undefined,
  portals: PortalOption[] | undefined,
  defaultDate: string | undefined,
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
    portalId: event.portal_id,
  };
}

type FieldsProps = {
  /** The event being edited. Null/undefined = creating a new event. */
  event?: EventFormValue | null;
  /** Fixed portal for new events (no picker shown). */
  portalId?: string;
  /** Portals to choose from for new events when `portalId` isn't fixed (aggregate view). */
  portals?: PortalOption[];
  /** Default date (YYYY-MM-DD) for a new event; defaults to today. */
  defaultDate?: string;
  /** Called with the saved row after a successful insert/update. */
  onSaved: (ev: EventFormValue) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
};

// The add/edit event form body — inputs + save logic, with NO dialog wrapper.
// State initializes on mount, so callers that only mount it while visible get a
// fresh form each time. Reused by EventFormDialog (calendar panel) and rendered
// inline inside the attendance modal (avoids stacking two Radix dialogs).
export function EventFormFields({ event, portalId, portals, defaultDate, onSaved, onCancel }: FieldsProps) {
  const editing = Boolean(event);
  const [fields, setFields] = useState<Fields>(() =>
    event ? fromEvent(event) : blankFields(portalId, portals, defaultDate),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showPortalPicker = !editing && !portalId && (portals?.length ?? 0) > 0;

  const save = async () => {
    const title = fields.title.trim();
    if (!title) { setError("Title is required."); return; }
    if (!fields.date) { setError("Date is required."); return; }
    if (!editing && !fields.portalId) { setError("Pick a portal."); return; }

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

    const payload = {
      title,
      description: fields.description.trim() || null,
      location: fields.location.trim() || null,
      start_time,
      end_time,
      all_day: fields.allDay,
    };

    // portal_events has no updated_at trigger, so set it manually on edits.
    // Editing keeps the event's own portal; creation uses the picked/fixed one.
    const query = editing
      ? supabase
          .from("portal_events")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", event!.id)
      : supabase
          .from("portal_events")
          .insert({ ...payload, portal_id: fields.portalId, created_by: user.id });

    const { data, error: saveError } = await query.select(EVENT_FORM_SELECT).single();

    if (saveError) { setError(saveError.message); setSaving(false); return; }

    onSaved(data as unknown as EventFormValue);
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-form-title">Title</Label>
        <Input
          id="event-form-title"
          value={fields.title}
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
          onChange={(e) => setFields((f) => ({ ...f, date: e.target.value }))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={fields.allDay}
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
              onChange={(e) => setFields((f) => ({ ...f, startTime: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <Label htmlFor="event-form-end">End</Label>
            <Input
              id="event-form-end"
              type="time"
              value={fields.endTime}
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
          onChange={(e) => setFields((f) => ({ ...f, location: e.target.value }))}
          placeholder="Optional"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="event-form-description">Description</Label>
        <textarea
          id="event-form-description"
          value={fields.description}
          onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
          rows={3}
          className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
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
export function EventFormDialog({ open, onOpenChange, event, portalId, portals, defaultDate, onSaved }: DialogProps) {
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
          defaultDate={defaultDate}
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
