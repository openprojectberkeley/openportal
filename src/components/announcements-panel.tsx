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
import {
  announcementStatus,
  dateInputToEndIso,
  dateInputToStartIso,
  formatAnnouncementDate,
  isoToDateInput,
  type Announcement,
  type AnnouncementStatus,
} from "@/lib/announcements";

type Fields = { message: string; color: string; start: string; end: string };

const DEFAULT_COLOR = "#3B82F6";
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const STATUS_STYLE: Record<AnnouncementStatus, string> = {
  live: "bg-green-500/15 text-green-700 dark:text-green-400",
  scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  ended: "bg-muted text-muted-foreground",
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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

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

    setSaving(true);
    setFormError(null);
    const supabase = createClient();
    const payload = {
      message,
      color: fields.color,
      starts_at: dateInputToStartIso(fields.start),
      ends_at: dateInputToEndIso(fields.end),
    };
    const { error: saveError } = editingId
      ? await supabase
          .from("announcements")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editingId)
      : await supabase.from("announcements").insert(payload);
    setSaving(false);
    if (saveError) return setFormError(saveError.message);
    setDialogOpen(false);
    await reload();
  };

  const remove = async (a: Announcement) => {
    const { error: deleteError } = await createClient().from("announcements").delete().eq("id", a.id);
    if (deleteError) {
      setError(deleteError.message);
      return false;
    }
    await reload();
    return true;
  };

  if (items === null) return <PanelListSkeleton rows={3} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Banners show at the top of everyone&apos;s dashboard between their start and end dates.
        </p>
        <Button size="sm" onClick={openCreate}>
          <PlusCircle size={15} /> New announcement
        </Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="border rounded-lg overflow-hidden">
        {items.map((a, i) => {
          const status = announcementStatus(a);
          return (
            <div key={a.id} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t")}>
              <span
                className="h-4 w-4 shrink-0 rounded-full border border-foreground/10"
                style={{ backgroundColor: a.color }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{a.message}</span>
                <span className="text-xs text-muted-foreground">
                  {formatAnnouncementDate(a.starts_at)} – {formatAnnouncementDate(a.ends_at)}
                </span>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  STATUS_STYLE[status],
                )}
              >
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
                className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                aria-label="Delete announcement"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No announcements yet.</div>
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
              <ColorPicker value={fields.color} onChange={(v) => setFields((f) => ({ ...f, color: v }))} />
            </div>
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
            {fields.message.trim() && HEX_RE.test(fields.color) && (
              <div className="flex flex-col gap-1">
                <Label>Preview</Label>
                <AnnouncementBanner message={fields.message.trim()} color={fields.color} />
              </div>
            )}
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
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
          const ok = await remove(deleting);
          if (ok) setDeleting(null);
          return ok;
        }}
      />
    </div>
  );
}
