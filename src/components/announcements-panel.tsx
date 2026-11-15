"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, PlusCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ColorPicker } from "@/components/color-picker";
import { PanelListSkeleton } from "@/components/skeletons";
import { AnnouncementBanner } from "@/components/announcement-banners";
import { cn } from "@/lib/utils";
import { staggerStyle } from "@/lib/motion";
import { accentRing } from "@/lib/portal-color";
import { optimistic } from "@/lib/optimistic";
import { InfoHint } from "@/components/ui/info-hint";
import {
  announcementStatus,
  dateInputToEndIso,
  dateInputToStartIso,
  formatAnnouncementDate,
  isoToDateInput,
  type Announcement,
  type AnnouncementStatus,
} from "@/lib/announcements";
import { Disclosure } from "@/components/ui/disclosure";

type Fields = { message: string; color: string; start: string; end: string };

const DEFAULT_COLOR = "#3B82F6";
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const STATUS_STYLE: Record<AnnouncementStatus, string> = {
  live: "text-success",
  scheduled: "text-info",
  ended: "text-muted-foreground",
};

function emptyFields(): Fields {
  const today = isoToDateInput(new Date().toISOString());
  return { message: "", color: DEFAULT_COLOR, start: today, end: today };
}

export function AnnouncementsPanel({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    const { data, error: loadError } = await createClient()
      .from("announcements")
      .select("id, message, color, starts_at, ends_at")
      .order("starts_at", { ascending: false });
    if (loadError) {
      setError(loadError.message);
      setItems([]);
      return;
    }
    setError(null);
    setItems((data as Announcement[]) ?? []);
    onCountChange?.(data?.length ?? 0);
  }, [onCountChange]);

  useEffect(() => {
    reload();
  }, [reload]);

  const openCreate = () => {
    setEditingId(null);
    setFields(emptyFields());
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditingId(a.id);
    setFields({
      message: a.message,
      color: a.color,
      start: isoToDateInput(a.starts_at),
      end: isoToDateInput(a.ends_at),
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const save = async () => {
    const message = fields.message.trim();
    if (!message) return setFormError("Message is required.");
    if (!HEX_RE.test(fields.color)) return setFormError("Pick a color.");
    if (!fields.start || !fields.end) return setFormError("Start and end dates are required.");
    if (fields.end < fields.start) return setFormError("End date must be on or after the start date.");

    setFormError(null);
    const supabase = createClient();
    const payload = {
      message,
      color: fields.color,
      starts_at: dateInputToStartIso(fields.start),
      ends_at: dateInputToEndIso(fields.end),
    };
    // Shown in the list and the dialog closed at once; the write follows. A
    // new one sits under a temp id until the reload brings the real row.
    const id = editingId ?? `temp-${Date.now()}`;
    const before = items;
    const next: Announcement = { id, ...payload } as Announcement;
    void optimistic({
      label: "announcement",
      key: `announcement:${id}`,
      apply: () => {
        setItems((prev) =>
          editingId
            ? (prev ?? []).map((a) => (a.id === editingId ? { ...a, ...payload } : a))
            : [next, ...(prev ?? [])],
        );
        setDialogOpen(false);
      },
      rollback: () => setItems(before),
      commit: () =>
        editingId
          ? supabase
              .from("announcements")
              .update({ ...payload, updated_at: new Date().toISOString() })
              .eq("id", editingId)
              .select("id")
          : supabase.from("announcements").insert(payload).select("id"),
      requireRows: true,
      onCommitted: () => void reload(),
    });
  };

  const remove = (a: Announcement) => {
    const before = items;
    void optimistic({
      label: "announcement deletion",
      key: `announcement:${a.id}`,
      apply: () => setItems((prev) => (prev ?? []).filter((x) => x.id !== a.id)),
      rollback: () => setItems(before),
      commit: () => createClient().from("announcements").delete().eq("id", a.id).select("id"),
      requireRows: true,
      onCommitted: () => onCountChange?.((before?.length ?? 1) - 1),
    });
    return true;
  };

  if (items === null) return <PanelListSkeleton rows={3} />;

  const q = query.trim().toLowerCase();
  const shownItems = q ? items.filter((a) => a.message.toLowerCase().includes(q)) : items;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search announcements..."
            aria-label="Search announcements"
            className="max-w-xs"
          />
          <InfoHint label="About announcements" side="right">
            Banners show under the header on every page between their start and end dates.
          </InfoHint>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusCircle size={15} /> New announcement
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-0.5">
        {shownItems.map((a, i) => {
          const status = announcementStatus(a);
          return (
            <div
              key={a.id}
              style={staggerStyle(i)}
              className="flex items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-foreground/[0.03] animate-fade-in-up"
            >
              <span
                className="h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: a.color, boxShadow: accentRing(a.color, 40) }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{a.message}</span>
                <span className="text-xs text-muted-foreground">
                  {formatAnnouncementDate(a.starts_at)} – {formatAnnouncementDate(a.ends_at)}
                </span>
              </div>
              {/* Status as dot + word, not a pill. */}
              <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium capitalize", STATUS_STYLE[status])}>
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                {status}
              </span>
              <button
                onClick={() => openEdit(a)}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                aria-label="Edit announcement"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => setDeleting(a)}
                className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                aria-label="Delete announcement"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
        {shownItems.length === 0 && (
          <div className="rounded-xl surface px-4 py-8 text-center text-sm text-muted-foreground">
            {items.length === 0 ? "No announcements yet." : "No announcements match."}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit announcement" : "New announcement"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="announcement-message">Message</Label>
              <textarea
                id="announcement-message"
                rows={3}
                value={fields.message}
                onChange={(e) => setFields((f) => ({ ...f, message: e.target.value }))}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="General meeting this Thursday at 7pm!"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Color</Label>
              <ColorPicker required value={fields.color} onChange={(v) => setFields((f) => ({ ...f, color: v }))} />
            </div>
            {/* Dates default to today; open them to schedule ahead or run longer. */}
            <Disclosure
              key={editingId ?? "new"}
              label="Schedule"
              hint={fields.start === fields.end ? formatAnnouncementDate(dateInputToStartIso(fields.start)) : undefined}
              defaultOpen={!!editingId}
            >
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="announcement-start">Start date</Label>
                  <Input
                    id="announcement-start"
                    type="date"
                    value={fields.start}
                    onChange={(e) => setFields((f) => ({ ...f, start: e.target.value }))}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="announcement-end">End date</Label>
                  <Input
                    id="announcement-end"
                    type="date"
                    value={fields.end}
                    min={fields.start || undefined}
                    onChange={(e) => setFields((f) => ({ ...f, end: e.target.value }))}
                  />
                </div>
              </div>
            </Disclosure>
            {fields.message.trim() && HEX_RE.test(fields.color) && (
              <div className="flex flex-col gap-1">
                <Label>Preview</Label>
                <AnnouncementBanner message={fields.message.trim()} color={fields.color} />
              </div>
            )}
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete announcement?"
        description="It will disappear from the dashboard immediately."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return false;
          remove(deleting);
          setDeleting(null);
          return true;
        }}
      />
    </div>
  );
}
