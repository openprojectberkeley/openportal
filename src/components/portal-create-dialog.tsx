"use client";

import { createClient } from "@/lib/supabase/client";
import { useRef, useState } from "react";
import { PlusCircle, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { uploadPortalIcon } from "@/lib/portal-icon-upload";

export type PortalType = "general" | "project" | "exec";
export type MemberOption = { user_id: string; name: string };
export type RoleOption = { id: string; role_name: string };
export type ProjectOption = { id: string; name: string };

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
  projectOptions: ProjectOption[];
  /** When provided, an optional "admins" picker is shown. */
  memberOptions?: MemberOption[];
  /** When provided, an optional "admin roles" picker is shown. */
  roleOptions?: RoleOption[];
  onCreated: (portal: CreatedPortal) => void;
  /** Trigger button label. */
  label?: string;
};

export function PortalCreateDialog({
  allowedTypes,
  projectOptions,
  memberOptions,
  roleOptions,
  onCreated,
  label = "New portal",
}: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PortalType>(allowedTypes[0] ?? "general");
  const [projectId, setProjectId] = useState<string>("");
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
  const [error, setError] = useState<string | null>(null);
  // Remembers a portal already inserted this session so an icon-upload retry
  // updates it instead of creating a duplicate row.
  const createdRef = useRef<CreatedPortal | null>(null);

  const reset = () => {
    setType(allowedTypes[0] ?? "general");
    setProjectId("");
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

  const toggleAdmin = (id: string) =>
    setAdminIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAdminRole = (id: string) =>
    setAdminRoleIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name is required."); return; }
    if (type === "project" && !projectId) { setError("Select a project."); return; }

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
        project_id: type === "project" ? projectId : null,
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

  const selectedProject = projectOptions.find((p) => p.id === projectId);

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
                <div className="flex gap-1 rounded-md border p-0.5 w-fit">
                  {allowedTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        type === t
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Project selector (project type only) */}
            {type === "project" && (
              <div className="flex flex-col gap-1">
                <Label>Project</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors w-full text-left">
                      <span className={selectedProject ? "" : "text-muted-foreground"}>
                        {selectedProject ? selectedProject.name : "Select a project"}
                      </span>
                      <ChevronDown size={15} className="text-muted-foreground flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {projectOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No projects available
                      </div>
                    ) : (
                      projectOptions.map((p) => (
                        <DropdownMenuItem key={p.id} onSelect={() => setProjectId(p.id)}>
                          {p.name}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="text-xs text-muted-foreground">
                  Project members join automatically; PMs become admins.
                </p>
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

            {/* Optional admin members */}
            {memberOptions && memberOptions.length > 0 && (
              <div className="flex flex-col gap-1">
                <Label>Admins (optional)</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors w-full text-left">
                      <span className={adminIds.size ? "" : "text-muted-foreground"}>
                        {adminIds.size ? `${adminIds.size} selected` : "None"}
                      </span>
                      <ChevronDown size={15} className="text-muted-foreground flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {memberOptions.map((m) => (
                      <DropdownMenuCheckboxItem
                        key={m.user_id}
                        checked={adminIds.has(m.user_id)}
                        onCheckedChange={() => toggleAdmin(m.user_id)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {m.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Optional admin roles */}
            {roleOptions && roleOptions.length > 0 && (
              <div className="flex flex-col gap-1">
                <Label>Admin roles (optional)</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors w-full text-left">
                      <span className={adminRoleIds.size ? "" : "text-muted-foreground"}>
                        {adminRoleIds.size ? `${adminRoleIds.size} selected` : "None"}
                      </span>
                      <ChevronDown size={15} className="text-muted-foreground flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {roleOptions.map((r) => (
                      <DropdownMenuCheckboxItem
                        key={r.id}
                        checked={adminRoleIds.has(r.id)}
                        onCheckedChange={() => toggleAdminRole(r.id)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {r.role_name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
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
