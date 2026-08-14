"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { PlusCircle, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { usePortalMeta } from "@/components/portal-meta-provider";

export type PortalMeta = { name: string; icon: string; iconUrl: string | null; color: string; description: string };

type RoleOption = { id: number; role_name: string };
type PortalRoleRow = { role_id: number; role_name: string; is_admin: boolean };

type Props = {
  portalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: PortalMeta;
  onMetaSaved: (meta: PortalMeta) => void;
};

// Admin-only portal config: metadata (name/icon/color/description) plus the
// auto-assign role mappings. Roster editing lives in the View Members modal.
export function PortalSettingsModal({ portalId, open, onOpenChange, initial, onMetaSaved }: Props) {
  const { setPortalMeta } = usePortalMeta();
  const [meta, setMeta] = useState<PortalMeta>(initial);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [roles, setRoles] = useState<PortalRoleRow[]>([]);
  const [allRoles, setAllRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Reseed the form each time the dialog opens.
  useEffect(() => {
    if (open) setMeta(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    setLoading(true);
    Promise.all([
      supabase.from("portal_roles").select("role_id, is_admin, roles(role_name)").eq("portal_id", portalId),
      supabase.from("roles").select("id, role_name").order("role_name"),
    ]).then(([{ data: prRows }, { data: roleRows }]) => {
      setRoles(
        (prRows ?? []).map((r) => ({
          role_id: r.role_id as number,
          role_name: (r.roles as unknown as { role_name: string } | null)?.role_name ?? "—",
          is_admin: r.is_admin as boolean,
        })),
      );
      setAllRoles((roleRows ?? []) as RoleOption[]);
      setLoading(false);
    });
  }, [open, portalId]);

  const saveMeta = async () => {
    const name = meta.name.trim();
    if (!name) { setMetaError("Name is required."); return; }
    setSavingMeta(true);
    setMetaError(null);
    const supabase = createClient();
    const payload = {
      name,
      icon: meta.icon.trim() || null,
      icon_url: meta.iconUrl || null,
      color: meta.color.trim() || null,
      description: meta.description.trim() || null,
    };
    const { error } = await supabase
      .from("portals")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", portalId);
    if (error) { setMetaError(error.message); setSavingMeta(false); return; }
    setSavingMeta(false);
    // Broadcast to every consumer (cards, calendar tints, header) for an
    // instant, reload-free update.
    setPortalMeta(portalId, {
      name,
      icon: payload.icon,
      icon_url: payload.icon_url,
      color: payload.color,
      description: payload.description,
    });
    onMetaSaved({
      name,
      icon: payload.icon ?? "",
      iconUrl: payload.icon_url,
      color: payload.color ?? "",
      description: payload.description ?? "",
    });
    onOpenChange(false);
  };

  const addRole = async (role: RoleOption) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("portal_roles")
      .insert({ portal_id: portalId, role_id: role.id, is_admin: false });
    if (error) return;
    setRoles((prev) => [...prev, { role_id: role.id, role_name: role.role_name, is_admin: false }]);
  };

  const removeRole = async (role: PortalRoleRow) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("portal_roles")
      .delete()
      .eq("portal_id", portalId)
      .eq("role_id", role.role_id);
    if (error) return;
    setRoles((prev) => prev.filter((r) => r.role_id !== role.role_id));
  };

  const toggleRoleAdmin = async (role: PortalRoleRow) => {
    const next = !role.is_admin;
    const supabase = createClient();
    const { error } = await supabase
      .from("portal_roles")
      .update({ is_admin: next })
      .eq("portal_id", portalId)
      .eq("role_id", role.role_id);
    if (error) return;
    setRoles((prev) => prev.map((r) => (r.role_id === role.role_id ? { ...r, is_admin: next } : r)));
  };

  const available = allRoles.filter((r) => !roles.some((pr) => pr.role_id === r.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Portal settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {/* Metadata */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ps-name">Name</Label>
              <Input id="ps-name" value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 w-28">
                <Label>Icon</Label>
                <IconPicker
                  value={meta.icon}
                  onChange={(v) => setMeta((m) => ({ ...m, icon: v }))}
                  imageUrl={meta.iconUrl}
                  onImageChange={(url) => setMeta((m) => ({ ...m, iconUrl: url }))}
                  portalId={portalId}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <Label>Accent color</Label>
                <ColorPicker value={meta.color} onChange={(v) => setMeta((m) => ({ ...m, color: v }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ps-desc">Description</Label>
              <textarea
                id="ps-desc"
                rows={3}
                value={meta.description}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {metaError && <p className="text-sm text-red-500">{metaError}</p>}
            <div className="flex justify-end">
              <Button size="sm" onClick={saveMeta} disabled={savingMeta}>
                {savingMeta ? "Saving..." : "Save details"}
              </Button>
            </div>
          </div>

          {/* Auto-assign role mappings */}
          <div className="flex flex-col gap-1.5 border-t pt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Auto-assign roles
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <PlusCircle size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                  {available.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No roles left to add</div>
                  ) : (
                    available.map((r) => (
                      <DropdownMenuItem key={r.id} onSelect={() => addRole(r)}>
                        {r.role_name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : roles.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No roles. Anyone with a mapped role is auto-added to this portal at the chosen tier.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {roles.map((r) => (
                  <div key={r.role_id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{r.role_name}</span>
                    <button
                      onClick={() => toggleRoleAdmin(r)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        r.is_admin
                          ? "bg-foreground text-background"
                          : "bg-foreground/10 text-foreground hover:bg-foreground/20"
                      }`}
                    >
                      Admin
                    </button>
                    <button onClick={() => removeRole(r)} className="text-muted-foreground hover:text-red-500 transition-colors">
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
