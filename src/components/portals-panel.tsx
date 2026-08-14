"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, PlusCircle, Pencil, X, Lock } from "lucide-react";
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
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { PanelListSkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { PortalCreateDialog, type PortalType, type ProjectOption } from "@/components/portal-create-dialog";
import { AdminCrown } from "@/components/admin-crown";
import { PortalDefaultIcon } from "@/components/portal-default-icon";

export type MemberOption = { user_id: string; name: string };
export type RoleOption = { id: string; role_name: string };

type PortalMember = { user_id: string; name: string; is_admin: boolean; locked?: boolean; owner?: boolean };
type PortalRole = { id: string; role_name: string; is_admin: boolean };

type Portal = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  type: PortalType;
  project_id: string | null;
  project_name: string | null;
  members: PortalMember[];
  roles: PortalRole[];
};

type PortalFields = { name: string; description: string; icon: string; iconUrl: string | null; color: string };
const EMPTY_FIELDS: PortalFields = { name: "", description: "", icon: "", iconUrl: null, color: "" };

const TYPE_LABELS: Record<PortalType, string> = { general: "General", project: "Project", exec: "Exec" };

type Props = { members: MemberOption[]; allRoles: RoleOption[] };

export function PortalsPanel({ members, allRoles }: Props) {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<PortalFields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadPortals = useCallback(() => {
    return fetch("/api/admin/portals")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPortals(data);
      })
      .catch(() => setError("Failed to load."));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      loadPortals(),
      supabase.from("projects").select("id, name").order("name"),
    ]).then(([, { data: projectRows }]) => {
      setProjects(projectRows ?? []);
      setLoading(false);
    });
  }, [loadPortals]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openEdit = (p: Portal) => {
    setEditingId(p.id);
    setFields({
      name: p.name,
      description: p.description ?? "",
      icon: p.icon ?? "",
      iconUrl: p.icon_url,
      color: p.color ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = fields.name.trim();
    if (!name) { setFormError("Name is required."); return; }

    setSaving(true);
    setFormError(null);
    const supabase = createClient();
    const payload = {
      name,
      description: fields.description.trim() || null,
      icon: fields.icon.trim() || null,
      icon_url: fields.iconUrl || null,
      color: fields.color.trim() || null,
    };

    const { error: updateError } = await supabase
      .from("portals")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", editingId);

    if (updateError) { setFormError(updateError.message); setSaving(false); return; }
    setPortals((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...payload } : p)));
    setSaving(false);
    setDialogOpen(false);
  };

  const deletePortal = async (id: string) => {
    if (!confirm("Delete this portal? This also removes its roster and events.")) return;
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("portals").delete().eq("id", id);
    if (deleteError) return;
    setPortals((prev) => prev.filter((p) => p.id !== id));
  };

  const addMember = async (portal: Portal, member: MemberOption) => {
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("portal_members")
      .insert({ portal_id: portal.id, user_id: member.user_id, is_admin: false });

    if (insertError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id ? { ...p, members: [...p.members, { ...member, is_admin: false }] } : p,
      ),
    );
  };

  const removeMember = async (portal: Portal, member: PortalMember) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("portal_members")
      .delete()
      .eq("portal_id", portal.id)
      .eq("user_id", member.user_id);

    if (deleteError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id ? { ...p, members: p.members.filter((m) => m.user_id !== member.user_id) } : p,
      ),
    );
  };

  const toggleAdmin = async (portal: Portal, member: PortalMember) => {
    const nextIsAdmin = !member.is_admin;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("portal_members")
      .update({ is_admin: nextIsAdmin })
      .eq("portal_id", portal.id)
      .eq("user_id", member.user_id);

    if (updateError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id
          ? { ...p, members: p.members.map((m) => (m.user_id === member.user_id ? { ...m, is_admin: nextIsAdmin } : m)) }
          : p,
      ),
    );
  };

  const addRole = async (portal: Portal, role: RoleOption) => {
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("portal_roles")
      .insert({ portal_id: portal.id, role_id: role.id, is_admin: false });

    if (insertError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id ? { ...p, roles: [...p.roles, { ...role, is_admin: false }] } : p,
      ),
    );
  };

  const removeRole = async (portal: Portal, role: PortalRole) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("portal_roles")
      .delete()
      .eq("portal_id", portal.id)
      .eq("role_id", role.id);

    if (deleteError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id ? { ...p, roles: p.roles.filter((r) => r.id !== role.id) } : p,
      ),
    );
  };

  const toggleRoleAdmin = async (portal: Portal, role: PortalRole) => {
    const nextIsAdmin = !role.is_admin;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("portal_roles")
      .update({ is_admin: nextIsAdmin })
      .eq("portal_id", portal.id)
      .eq("role_id", role.id);

    if (updateError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id
          ? { ...p, roles: p.roles.map((r) => (r.id === role.id ? { ...r, is_admin: nextIsAdmin } : r)) }
          : p,
      ),
    );
  };

  if (loading) return <PanelListSkeleton />;
  if (error) return <div className="py-8 text-sm text-red-500">{error}</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <PortalCreateDialog
          allowedTypes={["general", "project", "exec"]}
          projectOptions={projects}
          memberOptions={members}
          roleOptions={allRoles}
          onCreated={() => loadPortals()}
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        {portals.map((p, i) => {
          const isOpen = expanded.has(p.id);
          const availableMembers = members.filter((m) => !p.members.some((pm) => pm.user_id === m.user_id));
          const availableRoles = allRoles.filter((r) => !p.roles.some((pr) => pr.id === r.id));
          return (
            <div key={p.id} className={i > 0 ? "border-t" : ""}>
              <div
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer"
                onClick={() => toggle(p.id)}
              >
                <span className="text-muted-foreground flex-shrink-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                {p.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.icon_url} alt="" className="h-6 w-6 flex-shrink-0 rounded object-cover" />
                ) : p.icon ? (
                  <span className="flex-shrink-0 text-lg leading-none">{p.icon}</span>
                ) : (
                  <PortalDefaultIcon
                    className="h-5 w-5 flex-shrink-0 text-muted-foreground"
                    style={{ color: p.color || undefined }}
                  />
                )}
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium">
                    {TYPE_LABELS[p.type]}
                    {p.type === "project" && p.project_name ? ` · ${p.project_name}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.members.length} member{p.members.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePortal(p.id); }}
                  className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <X size={15} />
                </button>
              </div>
              {isOpen && (
                <div className="px-11 pb-4 pt-3 flex flex-col gap-4 bg-accent/20">
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}

                  {/* Members roster. Project portals derive members from the
                      linked project (locked); explicit extras are editable. */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Members
                      </span>
                      <span className="text-[10px] font-normal text-muted-foreground/60">({p.members.length})</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="text-muted-foreground hover:text-foreground transition-colors">
                            <PlusCircle size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {availableMembers.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              No members left to add
                            </div>
                          ) : (
                            availableMembers.map((m) => (
                              <DropdownMenuItem key={m.user_id} onSelect={() => addMember(p, m)}>
                                {m.name}
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {p.members.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No members yet.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {p.members.map((m) => (
                          <div key={m.user_id} className="flex items-center gap-2 text-sm">
                            <PersonName userId={m.user_id} name={m.name} className="flex-1" />
                            {m.locked && (
                              <span className="text-[10px] text-muted-foreground/70 italic">
                                {m.owner ? "owner" : "via project"}
                              </span>
                            )}
                            {m.locked && m.is_admin && (
                              <Lock size={12} className="text-muted-foreground/60" aria-label="Admin locked" />
                            )}
                            <AdminCrown
                              active={m.is_admin}
                              owner={m.owner}
                              locked={m.locked}
                              onToggle={m.locked ? undefined : () => toggleAdmin(p, m)}
                            />
                            {m.locked ? (
                              <span className="w-4 flex-shrink-0" aria-hidden />
                            ) : (
                              <button
                                onClick={() => removeMember(p, m)}
                                className="w-4 flex-shrink-0 flex justify-center text-muted-foreground hover:text-red-500 transition-colors"
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Auto-assigned roles: everyone with the role joins the portal;
                      the Admin toggle sets the tier that mapping grants. */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Roles
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="text-muted-foreground hover:text-foreground transition-colors">
                            <PlusCircle size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {availableRoles.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              No roles left to add
                            </div>
                          ) : (
                            availableRoles.map((r) => (
                              <DropdownMenuItem key={r.id} onSelect={() => addRole(p, r)}>
                                {r.role_name}
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {p.roles.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No roles. Anyone with a mapped role is auto-added to this portal at the chosen tier.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {p.roles.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 text-sm">
                            <span className="flex-1">{r.role_name}</span>
                            <AdminCrown active={r.is_admin} onToggle={() => toggleRoleAdmin(p, r)} />
                            <button
                              onClick={() => removeRole(p, r)}
                              className="w-4 flex-shrink-0 flex justify-center text-muted-foreground hover:text-red-500 transition-colors"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {portals.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No portals yet.</div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit portal</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="portal-name">Name</Label>
              <Input
                id="portal-name"
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
                  portalId={editingId ?? undefined}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <Label>Accent color</Label>
                <ColorPicker value={fields.color} onChange={(v) => setFields((f) => ({ ...f, color: v }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="portal-description">Description</Label>
              <textarea
                id="portal-description"
                value={fields.description}
                onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
