"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X, UserPlus, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/overlay-scrollbar";

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

type MemberOption = { user_id: string; name: string };
type AccessGrant = { id: string; user_id: string; name: string; expires_at: string };

const fullName = (first: string | null | undefined, last: string | null | undefined) =>
  [first, last].filter(Boolean).join(" ") || "—";

// The org runs on Pacific time, so "midnight" always means Pacific midnight,
// regardless of the viewer's own browser timezone. Returns 00:00 Pacific on
// the given Pacific calendar day (Date.UTC normalizes day overflow, e.g.
// day 33) as a UTC ISO instant.
function pacificMidnightIso(y: number, m: number, d: number): string {
  const tz = "America/Los_Angeles";
  // Pacific's UTC offset in minutes (negative — e.g. -420 for PDT, -480 for
  // PST). Sample it *on the target day* (probe at noon UTC, safely away from
  // the 2 AM transition), not at `now`: a grant made just before a DST change
  // would otherwise apply the wrong offset to the future midnight and land an
  // hour off.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetPart = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetPart);
  const offsetMin = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : -480;

  const utcMillis = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60_000;
  return new Date(utcMillis).toISOString();
}

// Default expiry offered when granting, as a datetime-local value (reuses
// toDateTimeLocal above so it renders in the viewer's own local time, even
// though the underlying instant is anchored to Pacific midnight).
//
// It targets the *end of tomorrow* Pacific (i.e. the start of the day after
// tomorrow), so a grant always covers at least a full day. Anchoring to the
// next upcoming midnight instead meant an extension added in the evening
// expired an hour or two later, at that same night's midnight — the applicant
// got kicked out mid-application. The admin can still shorten it in the field.
function defaultExpiryLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return toDateTimeLocal(pacificMidnightIso(get("year"), get("month"), get("day") + 2));
}

const formatExpiry = (iso: string) => {
  const label = new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return new Date(iso).getTime() < Date.now() ? `expired ${label}` : `until ${label}`;
};

// Popover with a search box over `options`, filtered by name as you type —
// same shape as AddMemberPicker (add-member-picker.tsx) minus its role/project
// filters, which don't apply here — followed by an expiry-date step once a
// person is picked.
function GrantAccessPicker({
  options,
  onGrant,
}: {
  options: MemberOption[];
  onGrant: (m: MemberOption, expiresAt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<MemberOption | null>(null);
  const [expiresAt, setExpiresAt] = useState(defaultExpiryLocal());

  // Portal the popover into an enclosing Dialog's content so it inherits that
  // dialog's pointer-events region and focus scope (same trick as
  // AddMemberPicker) — this section always renders inside ApplicationPeriodsDialog.
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const probeRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) setDialogContainer(node.closest<HTMLElement>("[role='dialog']"));
  }, []);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === "" ? options : options.filter((m) => m.name.toLowerCase().includes(q));
  }, [options, search]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearch("");
      setPending(null);
      setExpiresAt(defaultExpiryLocal());
    }
  };

  const confirm = () => {
    if (!pending || !expiresAt) return;
    onGrant(pending, toIso(expiresAt));
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <span ref={probeRef} className="hidden" aria-hidden />
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus size={14} className="mr-1.5" />
          Grant access
        </Button>
      </PopoverTrigger>
      <PopoverContent container={dialogContainer} side="bottom" align="start" className="w-64 p-2">
        {pending ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm px-1 font-medium">{pending.name}</p>
            <label className="flex flex-col gap-1 text-xs font-medium px-1">
              Until
              <input
                type="datetime-local"
                value={expiresAt}
                min={toDateTimeLocal(new Date().toISOString())}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="border rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="flex-1" onClick={() => setPending(null)}>
                Back
              </Button>
              <Button size="sm" className="flex-1" onClick={confirm} disabled={!expiresAt}>
                Grant access
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              autoFocus
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
            <ScrollArea className="max-h-56">
              {options.length === 0 ? (
                <p className="px-2 py-3 text-xs text-center text-muted-foreground">Everyone already has access</p>
              ) : results.length === 0 ? (
                <p className="px-2 py-3 text-xs text-center text-muted-foreground">No matches</p>
              ) : (
                <div className="flex flex-col">
                  {results.map((m) => (
                    <button
                      key={m.user_id}
                      onClick={() => setPending(m)}
                      className="rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// VP Tech/President only: lets the currently-closed (or open) period keep
// accepting one specific applicant's writes past its global status, via the
// application_period_access table (RLS-gated to VP Tech/President, no RPC
// layer — see 0069_application_period_extended_access.sql). `allMembers` is
// fetched once at the dialog level and passed down.
function ExtendedAccessSection({ periodId, allMembers }: { periodId: string; allMembers: MemberOption[] }) {
  const [grants, setGrants] = useState<AccessGrant[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which grant's expiry is being edited inline, and its in-progress value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Postgres' unique-violation code — surfaces if this section's `grants` list
  // is stale (e.g. it failed to load) and the picker offered someone who
  // already has a grant; re-fetching resolves the staleness rather than
  // leaving the row un-added and the list still wrong.
  const UNIQUE_VIOLATION_CODE = "23505";

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("application_period_access")
      // Explicit relationship hint: the table has two FKs into members
      // (user_id and granted_by), so a bare `members(...)` embed is
      // ambiguous to PostgREST and errors out rather than picking one.
      .select("id, user_id, expires_at, members!application_period_access_user_id_fkey(preferred_firstname, lastname)")
      .eq("period_id", periodId);
    if (err) { setError(err.message); setGrants([]); return; }
    const rows = (data ?? []) as unknown as {
      id: string;
      user_id: string;
      expires_at: string;
      members: { preferred_firstname: string | null; lastname: string | null } | null;
    }[];
    setGrants(
      rows
        .map((r) => ({
          id: r.id,
          user_id: r.user_id,
          expires_at: r.expires_at,
          name: fullName(r.members?.preferred_firstname, r.members?.lastname),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, [periodId]);

  useEffect(() => { load(); }, [load]);

  const available = useMemo(
    () => allMembers.filter((m) => !(grants ?? []).some((g) => g.user_id === m.user_id)),
    [allMembers, grants],
  );

  const grant = async (m: MemberOption, expiresAt: string) => {
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("application_period_access")
      .insert({ period_id: periodId, user_id: m.user_id, expires_at: expiresAt });
    if (err && err.code !== UNIQUE_VIOLATION_CODE) { setError(err.message); return; }
    load();
  };

  const saveExpiry = async (g: AccessGrant) => {
    if (!editValue) return;
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("application_period_access")
      .update({ expires_at: toIso(editValue) })
      .eq("id", g.id);
    if (err) { setError(err.message); return; }
    setEditingId(null);
    load();
  };

  const revoke = async (g: AccessGrant) => {
    setError(null);
    setRemovingId(g.user_id);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("application_period_access")
      .delete()
      .eq("period_id", periodId)
      .eq("user_id", g.user_id);
    setRemovingId(null);
    if (err) { setError(err.message); return; }
    load();
  };

  return (
    <div className="flex flex-col gap-2 border-t pt-2.5 mt-1">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Extended access
      </Label>
      <p className="text-xs text-muted-foreground">
        These people can keep applying to this period even while it&apos;s closed to everyone else. Click a date to change it.
      </p>
      {grants && grants.length > 0 && (
        <ul className="flex flex-col gap-1">
          {grants.map((g) => {
            const expired = new Date(g.expires_at).getTime() < Date.now();
            return (
              <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{g.name}</span>
                {editingId === g.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="datetime-local"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="border rounded-md px-1.5 py-0.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => saveExpiry(g)}
                      disabled={!editValue}
                      aria-label={`Save ${g.name}'s expiry`}
                      className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
                    >
                      <Check size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel"
                      className="text-muted-foreground hover:text-red-500 h-6 w-6 p-0"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingId(g.id); setEditValue(toDateTimeLocal(g.expires_at)); }}
                    className={`text-xs shrink-0 underline decoration-dotted underline-offset-2 hover:text-foreground ${expired ? "text-red-500" : "text-muted-foreground"}`}
                  >
                    {formatExpiry(g.expires_at)}
                  </button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke(g)}
                  disabled={removingId === g.user_id}
                  aria-label={`Remove ${g.name}`}
                  className="text-muted-foreground hover:text-red-500 h-6 w-6 p-0 shrink-0"
                >
                  <X size={14} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <GrantAccessPicker options={available} onGrant={grant} />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

function PeriodRow({
  period,
  onChanged,
  canManageExtendedAccess,
  allMembers,
}: {
  period: ApplicationPeriod;
  onChanged: () => void;
  canManageExtendedAccess: boolean;
  allMembers: MemberOption[];
}) {
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
      {canManageExtendedAccess && <ExtendedAccessSection periodId={period.id} allMembers={allMembers} />}
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
// the parent's period list after any write. `canManageExtendedAccess` (VP
// Tech/President only, see manager/applications/page.tsx's canEmailBlast) gates
// each period's "Extended access" grant list.
export function ApplicationPeriodsDialog({
  open,
  onOpenChange,
  periods,
  onChanged,
  canManageExtendedAccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periods: ApplicationPeriod[];
  onChanged: () => void;
  canManageExtendedAccess: boolean;
}) {
  // Fetched once for the whole dialog (only VP Tech/President need it) and
  // handed to each period's ExtendedAccessSection — the member directory is
  // readable by any authenticated user, so this is just avoiding N duplicate
  // fetches for N periods.
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);

  useEffect(() => {
    if (!open || !canManageExtendedAccess) return;
    const supabase = createClient();
    supabase
      .from("members")
      .select("user_id, preferred_firstname, lastname")
      .then(({ data }) => {
        const rows = (data ?? []) as { user_id: string; preferred_firstname: string | null; lastname: string | null }[];
        setAllMembers(
          rows
            .map((m) => ({ user_id: m.user_id, name: fullName(m.preferred_firstname, m.lastname) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      });
  }, [open, canManageExtendedAccess]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Application periods</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {periods.map((p) => (
            <PeriodRow
              key={p.id}
              period={p}
              onChanged={onChanged}
              canManageExtendedAccess={canManageExtendedAccess}
              allMembers={allMembers}
            />
          ))}
          <NewPeriodForm onChanged={onChanged} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
