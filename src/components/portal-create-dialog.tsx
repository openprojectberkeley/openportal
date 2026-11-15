"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useRef, useState } from "react";
import { PlusCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { MultiCombobox } from "@/components/ui/combobox";
import { uploadPortalIcon } from "@/lib/portal-icon-upload";
import { Segmented } from "@/components/ui/segmented";
import { Disclosure } from "@/components/ui/disclosure";

export type PortalType = "general" | "project" | "exec";
export type MemberOption = { user_id: string; name: string };
export type RoleOption = { id: string; role_name: string };

// The row returned after insert, handed back so the caller can update its list.
export type CreatedPortal = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  type: PortalType;
  project_id: string | null;
};

const TYPE_LABELS: Record<PortalType, string> = {
  general: "General",
  project: "Project",
  exec: "Exec",
};

type Props = {
  allowedTypes: PortalType[];
  /** When provided, an optional "admins" picker is shown. */
  memberOptions?: MemberOption[];
  /** When provided, an optional "admin roles" picker is shown. */
  roleOptions?: RoleOption[];
  onCreated: (portal: CreatedPortal) => void;
  /** Trigger button label. */
  label?: string;
};

// Project portals are created automatically when a project is created (never
// from here), so this dialog only creates general/exec portals.
export function PortalCreateDialog({
  allowedTypes,
  memberOptions,
  roleOptions,
  onCreated,
  label = "New portal",
}: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PortalType>(allowedTypes[0] ?? "general");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  // Deferred icon image: preview URL (object URL) + the blob we upload once the
  // portal row exists and we have its id.
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [color, setColor] = useState("");
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [adminRoleIds, setAdminRoleIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // Portal the admin pickers into this dialog so they stay inside its focus
  // scope and pointer-events region.
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const probeRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) setDialogContainer(node.closest<HTMLElement>("[role='dialog']"));
  }, []);
  const [error, setError] = useState<string | null>(null);
  // Remembers a portal already inserted this session so an icon-upload retry
  // updates it instead of creating a duplicate row.
  const createdRef = useRef<CreatedPortal | null>(null);

  const reset = () => {
    setType(allowedTypes[0] ?? "general");
    setName("");
    setDescription("");
    setIcon("");
    setIconUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setIconBlob(null);
    setColor("");
    setAdminIds(new Set());
    setAdminRoleIds(new Set());
    setError(null);
  };

  const openDialog = () => {
    reset();
    setOpen(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name is required."); return; }

    setSaving(true);
    setError(null);
    const supabase = createClient();

    // Reuse the row if a prior attempt already created it (icon upload failed).
    let created = createdRef.current;

    if (!created) {
      const payload = {
        name: trimmed,
        description: description.trim() || null,
        icon: icon.trim() || null,
        color: color.trim() || null,
        type,
        project_id: null,
      };

      const { data, error: insertError } = await supabase
        .from("portals")
        .insert(payload)
        .select("id, name, description, icon, icon_url, color, type, project_id")
        .single();

      if (insertError || !data) {
        setError(insertError?.message ?? "Failed to create portal.");
        setSaving(false);
        return;
      }

      created = data as CreatedPortal;
      createdRef.current = created;

      // Optional extra admins / admin-roles, layered on top of any derived roster.
      if (adminIds.size > 0) {
        await supabase.from("portal_members").insert(
          [...adminIds].map((user_id) => ({ portal_id: created!.id, user_id, is_admin: true })),
        );
      }
      if (adminRoleIds.size > 0) {
        await supabase.from("portal_roles").insert(
          [...adminRoleIds].map((role_id) => ({ portal_id: created!.id, role_id, is_admin: true })),
        );
      }
    }

    // Now that the row exists (creator is a locked admin via trigger), upload the
    // chosen icon image and persist its URL. Retryable without re-inserting.
    if (iconBlob) {
      try {
        const url = await uploadPortalIcon(supabase, created.id, iconBlob);
        await supabase.from("portals").update({ icon_url: url }).eq("id", created.id);
        created = { ...created, icon_url: url };
      } catch (uploadErr) {
        setError(uploadErr instanceof Error ? uploadErr.message : "Icon upload failed. Try again.");
        setSaving(false);
        return;
      }
    }

    onCreated(created);
    createdRef.current = null;
    setSaving(false);
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <PlusCircle size={15} /> {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New portal</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {/* Type selector */}
            {allowedTypes.length > 1 && (
              <div className="flex flex-col gap-1">
                <Label>Type</Label>
                <Segmented
                  aria-label="Portal type"
                  size="md"
                  className="w-fit"
                  value={type}
                  onChange={setType}
                  options={allowedTypes.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="new-portal-name">Name</Label>
              <Input
                id="new-portal-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Name and type are all a portal needs; the rest is optional. */}
            <Disclosure hint="icon, colour, description, admins">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 w-28">
                  <Label>Icon</Label>
                  <IconPicker
                    value={icon}
                    onChange={setIcon}
                    imageUrl={iconUrl}
                    onImageChange={setIconUrl}
                    onImageBlob={setIconBlob}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <Label>Accent color</Label>
                  <ColorPicker value={color} onChange={setColor} />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="new-portal-description">Description</Label>
                <textarea
                  id="new-portal-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Optional admins: searchable multi-selects, picks shown as chips. */}
              <span ref={probeRef} className="hidden" aria-hidden />
              {memberOptions && memberOptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label>Admins</Label>
                  <MultiCombobox
                    aria-label="Admins"
                    container={dialogContainer}
                    value={[...adminIds]}
                    onChange={(v) => setAdminIds(new Set(v))}
                    options={memberOptions.map((m) => ({ value: m.user_id, label: m.name }))}
                    placeholder="None"
                    searchPlaceholder="Search members…"
                  />
                </div>
              )}

              {roleOptions && roleOptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label>Admin roles</Label>
                  <MultiCombobox
                    aria-label="Admin roles"
                    container={dialogContainer}
                    value={[...adminRoleIds].map(String)}
                    onChange={(v) => setAdminRoleIds(new Set(v))}
                    options={roleOptions.map((r) => ({ value: String(r.id), label: r.role_name }))}
                    placeholder="None"
                    searchPlaceholder="Search roles…"
                  />
                </div>
              )}
            </Disclosure>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
