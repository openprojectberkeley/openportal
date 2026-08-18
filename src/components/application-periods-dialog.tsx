"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export type PeriodStatus = "draft" | "open" | "closed";

export type ApplicationPeriod = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  status: PeriodStatus;
};

const STATUSES: PeriodStatus[] = ["draft", "open", "closed"];
const STATUS_LABELS: Record<PeriodStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
};

// timestamptz <-> local 'YYYY-MM-DDTHH:mm' (the value format of
// <input type="datetime-local">). A period's window carries an exact date + time.
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const toIso = (local: string) => new Date(local).toISOString();

function StatusPicker({
  value,
  onChange,
}: {
  value: PeriodStatus;
  onChange: (s: PeriodStatus) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs font-medium">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`px-2.5 py-1 rounded-[5px] transition-colors ${
            value === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

function PeriodRow({ period, onChanged }: { period: ApplicationPeriod; onChanged: () => void }) {
  const [name, setName] = useState(period.name);
  const [start, setStart] = useState(toDateTimeLocal(period.starts_at));
  const [end, setEnd] = useState(toDateTimeLocal(period.ends_at));
  const [status, setStatus] = useState<PeriodStatus>(period.status);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== period.name ||
    start !== toDateTimeLocal(period.starts_at) ||
    end !== toDateTimeLocal(period.ends_at) ||
    status !== period.status;

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError("Name is required."); return; }
    if (!start || !end) { setError("Pick a start and end."); return; }
    if (start >= end) { setError("Start must be before end."); return; }
    setSaving(true);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("application_periods")
      .update({
        name: name.trim(),
        starts_at: toIso(start),
        ends_at: toIso(end),
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", period.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onChanged();
  };

  const remove = async () => {
    if (!window.confirm(
      `Delete the "${period.name}" period? Applications submitted for it will be detached (kept, but no longer tied to any period). This can't be undone.`,
    )) return;
    setError(null);
    setDeleting(true);
    const supabase = createClient();
    const { error: err } = await supabase.from("application_periods").delete().eq("id", period.id);
    setDeleting(false);
    if (err) { setError(err.message); return; }
    onChanged();
  };

  return (
    <div className="flex flex-col gap-2.5 border rounded-lg p-3">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Period name" />
        <Button
          size="sm"
          variant="ghost"
          onClick={remove}
          disabled={deleting}
          aria-label="Delete period"
          className="text-muted-foreground hover:text-red-500 shrink-0"
        >
          <Trash2 size={16} />
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Start
          <input
            type="datetime-local"
            value={start}
            max={end || undefined}
            onChange={(e) => setStart(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          End
          <input
            type="datetime-local"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <div className="flex flex-col gap-1 text-xs font-medium">
          Status
          <StatusPicker value={status} onChange={setStatus} />
        </div>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

function NewPeriodForm({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!name.trim()) { setError("Name is required."); return; }
    if (!start || !end) { setError("Pick a start and end."); return; }
    if (start >= end) { setError("Start must be before end."); return; }
    setSaving(true);
    const supabase = createClient();
    const { error: err } = await supabase.from("application_periods").insert({
      name: name.trim(),
      starts_at: toIso(start),
      ends_at: toIso(end),
      status: "draft",
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setName(""); setStart(""); setEnd("");
    onChanged();
  };

  return (
    <div className="flex flex-col gap-2.5 border border-dashed rounded-lg p-3">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        New period
      </Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Fall 2026"' />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Start
          <input
            type="datetime-local"
            value={start}
            max={end || undefined}
            onChange={(e) => setStart(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          End
          <input
            type="datetime-local"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <Button size="sm" onClick={create} disabled={saving}>
          <Plus size={14} className="mr-1" />
          {saving ? "Creating…" : "Create"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        New periods start as <span className="font-medium">Draft</span>. Set one to{" "}
        <span className="font-medium">Open</span> to let non-members apply within its window.
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

// Exec-only dialog to create and edit application periods. `onChanged` refreshes
// the parent's period list after any write.
export function ApplicationPeriodsDialog({
  open,
  onOpenChange,
  periods,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periods: ApplicationPeriod[];
  onChanged: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Application periods</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {periods.map((p) => (
            <PeriodRow key={p.id} period={p} onChanged={onChanged} />
          ))}
          <NewPeriodForm onChanged={onChanged} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
