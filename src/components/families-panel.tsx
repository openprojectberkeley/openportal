"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, PlusCircle, Pencil, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { uploadFamilyIcon } from "@/lib/family-icon-upload";
import { PanelListSkeleton } from "@/components/skeletons";
import { FamilyMark } from "@/components/family-mark";
import { useFamilies, type FamilyProject } from "@/lib/use-families";
import { countLabel, type Family } from "@/lib/scoring";

// `iconUrl` is a real public URL when editing (IconPicker uploads immediately,
// keyed by the family id) and a local preview URL when creating — a new family
// has no id to key the Storage path on yet, so the picker hands the blob back
// through onImageBlob and saveFamily uploads it once the row exists. Same
// two-mode dance as projects-panel.
type FamilyFields = {
  name: string;
  description: string;
  icon: string;
  color: string;
  iconUrl: string | null;
};

const EMPTY_FIELDS: FamilyFields = {
  name: "",
  description: "",
  icon: "",
  color: "",
  iconUrl: null,
};

export function FamiliesPanel() {
  const { families, projectsByFamily, unassigned, error, reload } = useFamilies();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<FamilyFields>(EMPTY_FIELDS);
  // Create flow only: held until the family row (and so its id) exists.
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Family | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = () => {
    setEditingId(null);
    setFields(EMPTY_FIELDS);
    setIconBlob(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (f: Family) => {
    setEditingId(f.id);
    setFields({
      name: f.name,
      description: f.description ?? "",
      icon: f.icon ?? "",
      color: f.color ?? "",
      iconUrl: f.icon_url,
    });
    setIconBlob(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const saveFamily = async () => {
    const name = fields.name.trim();
    if (!name) {
      setFormError("Name is required.");
      return;
    }

    setSaving(true);
    setFormError(null);
    const supabase = createClient();
    const payload = {
      name,
      description: fields.description.trim() || null,
      icon: fields.icon.trim() || null,
      color: fields.color.trim() || null,
    };

    const fail = (e: { code?: string; message: string }) => {
      // The unique index on lower(name) is the one a human will hit.
      setFormError(
        e.code === "23505" ? "A family with that name already exists." : e.message,
      );
      setSaving(false);
    };

    if (editingId) {
      // Edit uses immediate icon upload, so fields.iconUrl is already a real URL.
      const { error: updateError } = await supabase
        .from("families")
        .update({
          ...payload,
          icon_url: fields.iconUrl || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingId);
      if (updateError) return fail(updateError);
    } else {
      const { data: created, error: insertError } = await supabase
        .from("families")
        .insert(payload)
        .select("id")
        .single();
      if (insertError) return fail(insertError);

      // Deferred icon image: upload now that the family (and its id) exists.
      if (iconBlob && created) {
        try {
          const url = await uploadFamilyIcon(supabase, created.id, iconBlob);
          await supabase.from("families").update({ icon_url: url }).eq("id", created.id);
        } catch (uploadErr) {
          setFormError(
            uploadErr instanceof Error ? uploadErr.message : "Icon upload failed. Try again.",
          );
          setSaving(false);
          // The family itself saved; only its image didn't. Show it either way
          // so the row isn't invisible while the dialog reports the failure.
          await reload();
          return;
        }
      }
    }

    setSaving(false);
    setDialogOpen(false);
    await reload();
  };

  const deleteFamily = async (f: Family) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("families").delete().eq("id", f.id);
    if (deleteError) {
      setRowError(deleteError.message);
      return false;
    }
    setRowError(null);
    await reload();
    return true;
  };

  // Assignment is a plain `projects` update; the 0103 trigger rejects it for
  // anyone who isn't exec, so there is no RPC to go through.
  const setProjectFamily = async (projectId: string, familyId: string | null) => {
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("projects")
      .update({ family_id: familyId, updated_at: new Date().toISOString() })
      .eq("id", projectId);

    if (updateError) {
      setRowError(updateError.message);
      return;
    }
    setRowError(null);
    await reload();
  };

  if (families === null) return <PanelListSkeleton rows={4} />;

  const renderProjectRow = (p: FamilyProject) => (
    <div key={p.id} className="flex items-center gap-2 text-sm">
      <span className="flex-1 truncate">{p.name}</span>
      <button
        onClick={() => setProjectFamily(p.id, null)}
        className="text-muted-foreground hover:text-red-500 transition-colors"
        aria-label={`Remove ${p.name} from this family`}
      >
        <X size={13} />
      </button>
    </div>
  );

  const renderRow = (f: Family, i: number) => {
    const isOpen = expanded.has(f.id);
    const mine = projectsByFamily.get(f.id) ?? [];

    return (
      <div key={f.id} className={i > 0 ? "border-t" : ""}>
        <div
          className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer"
          onClick={() => toggle(f.id)}
        >
          <span className="text-muted-foreground flex-shrink-0">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <FamilyMark icon={f.icon} iconUrl={f.icon_url} color={f.color} name={f.name} size={24} />
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <span className="font-medium text-sm">{f.name}</span>
            <span className="text-xs text-muted-foreground">{countLabel(mine.length, "project")}</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(f);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label={`Edit ${f.name}`}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(f);
            }}
            className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
            aria-label={`Delete ${f.name}`}
          >
            <X size={15} />
          </button>
        </div>
        {isOpen && (
          <div className="px-11 pb-4 pt-3 flex flex-col gap-3 bg-accent/20">
            {f.description && <p className="text-sm text-muted-foreground">{f.description}</p>}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Projects
                </span>
                <span className="text-[10px] font-normal text-muted-foreground/60">({mine.length})</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                      disabled={unassigned.length === 0}
                      aria-label={`Add a project to ${f.name}`}
                    >
                      <PlusCircle size={14} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                    {unassigned.map((p) => (
                      <DropdownMenuItem key={p.id} onSelect={() => setProjectFamily(p.id, f.id)}>
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {/* A family's score is the live sum over its current projects, so a
                  reassignment carries that project's whole history across. */}
              <p className="text-[11px] text-muted-foreground/80">
                Moving a project moves its points with it.
              </p>
              {mine.length === 0 ? (
                <p className="text-xs text-muted-foreground">No projects yet.</p>
              ) : (
                <div className="flex flex-col gap-1">{mine.map(renderProjectRow)}</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Families group projects for the scoreboard. A project belongs to one family.
        </p>
        <Button size="sm" onClick={openCreate}>
          <PlusCircle size={15} /> New family
        </Button>
      </div>

      {(error || rowError) && <p className="text-sm text-red-500">{error ?? rowError}</p>}

      <div className="border rounded-lg overflow-hidden">
        {families.map((f, i) => renderRow(f, i))}
        {families.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No families yet. Create one to start grouping projects.
          </div>
        )}
      </div>

      {unassigned.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Unassigned
            </h2>
            <span className="text-[10px] font-normal text-muted-foreground/60">({unassigned.length})</span>
          </div>
          <div className="border rounded-lg divide-y">
            {unassigned.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className="flex-1 truncate">{p.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                      disabled={families.length === 0}
                    >
                      Assign
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {families.map((f) => (
                      <DropdownMenuItem key={f.id} onSelect={() => setProjectFamily(p.id, f.id)}>
                        {f.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Points awarded to an unassigned project don&apos;t count for any family.
          </p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit family" : "New family"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="family-name">Name</Label>
              <Input
                id="family-name"
                value={fields.name}
                onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 w-28">
                <Label>Icon</Label>
                <IconPicker
                  value={fields.icon}
                  onChange={(v) => setFields((f) => ({ ...f, icon: v }))}
                  imageUrl={fields.iconUrl}
                  onImageChange={(url) => setFields((f) => ({ ...f, iconUrl: url }))}
                  onImageBlob={setIconBlob}
                  familyId={editingId ?? undefined}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <Label>Accent color</Label>
                <ColorPicker
                  value={fields.color}
                  onChange={(v) => setFields((f) => ({ ...f, color: v }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="family-description">Description</Label>
              <Input
                id="family-description"
                value={fields.description}
                onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveFamily} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={deleting ? `Delete ${deleting.name}?` : "Delete family"}
        description="Its projects aren't deleted — they become unassigned, and their points stop counting for any family. Past awards stay in the log."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return false;
          const ok = await deleteFamily(deleting);
          if (ok) setDeleting(null);
          return ok;
        }}
      />
    </div>
  );
}
