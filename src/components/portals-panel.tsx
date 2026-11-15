"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, PlusCircle, Pencil, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { PanelListSkeleton } from "@/components/skeletons";

import { PortalCreateDialog, type PortalType } from "@/components/portal-create-dialog";
import { ProjectEditDialog } from "@/components/project-edit-dialog";

import { PortalDefaultIcon } from "@/components/portal-default-icon";
import { AddMemberPicker, useAddMemberFilters } from "@/components/add-member-picker";
import { RosterList } from "@/components/roster-list";
import { useConfirm } from "@/components/ui/use-confirm";
import { staggerStyle } from "@/lib/motion";
import { optimistic } from "@/lib/optimistic";
import { CommandPicker } from "@/components/ui/combobox";
import { toastSaved } from "@/lib/saved-toast";

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
  /** Null until the row is expanded; the roster loads lazily. */
  members: PortalMember[] | null;
  member_count: number;
  admin_ids: string[];
  roles: PortalRole[];
};

const memberCount = (p: Portal) => p.members?.length ?? p.member_count;

type PortalFields = { name: string; description: string; icon: string; iconUrl: string | null; color: string };
const EMPTY_FIELDS: PortalFields = { name: "", description: "", icon: "", iconUrl: null, color: "" };

const TYPE_LABELS: Record<PortalType, string> = { general: "General", project: "Project", exec: "Exec" };

type Props = { members: MemberOption[]; allRoles: RoleOption[] };

export function PortalsPanel({ members, allRoles }: Props) {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const memberFilters = useAddMemberFilters(true);
  const [query, setQuery] = useState("");
  const { ask, dialog: confirmDialog } = useConfirm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<PortalFields>(EMPTY_FIELDS);
  const [formError, setFormError] = useState<string | null>(null);
  const [projectEditOpen, setProjectEditOpen] = useState(false);

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
    loadPortals().then(() => setLoading(false));
  }, [loadPortals]);

  // Rows first, details lazy: a row's roster loads the first time it opens,
  // showing skeleton rows meanwhile.
  const loadRoster = (id: string) => {
    fetch(`/api/admin/portals/${id}/members`)
      .then((r) => r.json())
      .then((rows) => {
        if (Array.isArray(rows)) setPortals((prev) => prev.map((p) => (p.id === id ? { ...p, members: rows } : p)));
      })
      .catch(() => {});
  };
  // The fetch starts outside the state updater (React may run updaters twice).
  const toggle = (id: string) => {
    const opening = !expanded.has(id);
    if (opening && portals.find((p) => p.id === id)?.members === null) loadRoster(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  // Every edit here is optimistic: the list changes at once, the write runs
  // behind it, and a refusal restores the list as it was and toasts (Retry).
  // Rare admin edits, so restoring the whole snapshot is fine.
  const mutate = (
    label: string,
    key: string,
    next: (prev: Portal[]) => Portal[],
    commit: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>,
  ) => {
    const before = portals;
    void optimistic({ label, key, apply: () => setPortals(next), rollback: () => setPortals(before), commit, requireRows: true });
  };

  const saveEdit = () => {
    if (!editingId) return;
    const id = editingId;
    const name = fields.name.trim();
    if (!name) { setFormError("Name is required."); return; }
    setFormError(null);
    const supabase = createClient();
    const payload = {
      name,
      description: fields.description.trim() || null,
      icon: fields.icon.trim() || null,
      icon_url: fields.iconUrl || null,
      color: fields.color.trim() || null,
    };
    setDialogOpen(false);
    toastSaved("Portal saved");
    mutate(
      "portal",
      `portal:${id}`,
      (prev) => prev.map((p) => (p.id === id ? { ...p, ...payload } : p)),
      () => supabase.from("portals").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id).select("id"),
    );
  };

  const deletePortal = (portal: Portal) => {
    ask({
      title: `Delete ${portal.name}?`,
      description: "This also removes its roster and events.",
      confirmLabel: "Delete",
      destructive: true,
      run: () => {
        const supabase = createClient();
        mutate("portal deletion", `portal:${portal.id}`, (prev) => prev.filter((p) => p.id !== portal.id), () =>
          supabase.from("portals").delete().eq("id", portal.id).select("id"),
        );
      },
    });
  };

  const patchPortal = (portalId: string, fn: (p: Portal) => Portal) => (prev: Portal[]) =>
    prev.map((p) => (p.id === portalId ? fn(p) : p));

  const addMember = (portal: Portal, member: MemberOption) => {
    const supabase = createClient();
    mutate(
      "member",
      `portal-member:${portal.id}:${member.user_id}`,
      patchPortal(portal.id, (p) => ({
        ...p,
        members: [...(p.members ?? []), { ...member, is_admin: false }],
        member_count: p.member_count + 1,
      })),
      () => supabase.from("portal_members").insert({ portal_id: portal.id, user_id: member.user_id, is_admin: false }).select("user_id"),
    );
  };

  const removeMember = (portal: Portal, member: PortalMember) => {
    const supabase = createClient();
    mutate(
      "member",
      `portal-member:${portal.id}:${member.user_id}`,
      patchPortal(portal.id, (p) => ({
        ...p,
        members: (p.members ?? []).filter((m) => m.user_id !== member.user_id),
        member_count: Math.max(0, p.member_count - 1),
      })),
      () => supabase.from("portal_members").delete().eq("portal_id", portal.id).eq("user_id", member.user_id).select("user_id"),
    );
  };

  const toggleAdmin = (portal: Portal, member: PortalMember) => {
    const nextIsAdmin = !member.is_admin;
    ask({
      title: nextIsAdmin ? `Make ${member.name} an admin of ${portal.name}?` : `Remove ${member.name} as admin of ${portal.name}?`,
      confirmLabel: nextIsAdmin ? "Make admin" : "Remove admin",
      destructive: !nextIsAdmin,
      run: () => applyToggleAdmin(portal, member, nextIsAdmin),
    });
  };
  const applyToggleAdmin = (portal: Portal, member: PortalMember, nextIsAdmin: boolean) => {
    const supabase = createClient();
    mutate(
      "admin access",
      `portal-admin:${portal.id}:${member.user_id}`,
      patchPortal(portal.id, (p) => ({
        ...p,
        members: (p.members ?? []).map((m) => (m.user_id === member.user_id ? { ...m, is_admin: nextIsAdmin } : m)),
        admin_ids: nextIsAdmin ? [...p.admin_ids, member.user_id] : p.admin_ids.filter((id) => id !== member.user_id),
      })),
      () =>
        supabase
          .from("portal_members")
          .update({ is_admin: nextIsAdmin })
          .eq("portal_id", portal.id)
          .eq("user_id", member.user_id)
          .select("user_id"),
    );
  };

  const addRole = (portal: Portal, role: RoleOption) => {
    const supabase = createClient();
    mutate(
      "role",
      `portal-role:${portal.id}:${role.id}`,
      patchPortal(portal.id, (p) => ({ ...p, roles: [...p.roles, { ...role, is_admin: false }] })),
      () => supabase.from("portal_roles").insert({ portal_id: portal.id, role_id: role.id, is_admin: false }).select("role_id"),
    );
  };

  const removeRole = (portal: Portal, role: PortalRole) => {
    const supabase = createClient();
    mutate(
      "role",
      `portal-role:${portal.id}:${role.id}`,
      patchPortal(portal.id, (p) => ({ ...p, roles: p.roles.filter((r) => r.id !== role.id) })),
      () => supabase.from("portal_roles").delete().eq("portal_id", portal.id).eq("role_id", role.id).select("role_id"),
    );
  };

  const toggleRoleAdmin = (portal: Portal, role: PortalRole) => {
    const nextIsAdmin = !role.is_admin;
    ask({
      title: nextIsAdmin
        ? `Make everyone with ${role.role_name} an admin of ${portal.name}?`
        : `Make ${role.role_name} regular members of ${portal.name}?`,
      confirmLabel: nextIsAdmin ? "Make admins" : "Make members",
      destructive: !nextIsAdmin,
      run: () => applyToggleRoleAdmin(portal, role, nextIsAdmin),
    });
  };
  const applyToggleRoleAdmin = (portal: Portal, role: PortalRole, nextIsAdmin: boolean) => {
    const supabase = createClient();
    mutate(
      "role access",
      `portal-role-admin:${portal.id}:${role.id}`,
      patchPortal(portal.id, (p) => ({
        ...p,
        roles: p.roles.map((r) => (r.id === role.id ? { ...r, is_admin: nextIsAdmin } : r)),
      })),
      () =>
        supabase
          .from("portal_roles")
          .update({ is_admin: nextIsAdmin })
          .eq("portal_id", portal.id)
          .eq("role_id", role.id)
          .select("role_id"),
    );
  };

  if (loading) return <PanelListSkeleton />;
  if (error) return <div className="py-8 text-sm text-destructive">{error}</div>;

  const q = query.trim().toLowerCase();
  const shownPortals = q
    ? portals.filter((p) =>
        [p.name, p.description ?? "", p.project_name ?? ""].some((t) => t.toLowerCase().includes(q)),
      )
    : portals;

  const editingPortal = portals.find((p) => p.id === editingId);
  // Project portals derive name/icon/color/description from the linked project
  // (locked here); edit them via "Edit project".
  const editingIsProject = editingPortal?.type === "project" && !!editingPortal.project_id;

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search portals..."
          aria-label="Search portals"
          className="max-w-xs"
        />
        <PortalCreateDialog
          allowedTypes={["general", "exec"]}
          memberOptions={members}
          roleOptions={allRoles}
          onCreated={() => loadPortals()}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        {shownPortals.map((p, i) => {
          const isOpen = expanded.has(p.id);
          const availableMembers = members.filter((m) => !(p.members ?? []).some((pm) => pm.user_id === m.user_id));
          // Admins of a project portal are its PMs (0013 maps is_pm -> is_admin).
          // Before the roster loads, names come from the light admin id list.
          const adminNames = p.members
            ? p.members.filter((m) => m.is_admin).map((m) => m.name)
            : p.admin_ids.map((id) => members.find((m) => m.user_id === id)?.name).filter(Boolean) as string[];
          const availableRoles = allRoles.filter((r) => !p.roles.some((pr) => pr.id === r.id));
          return (
            <div key={p.id} className="rounded-lg transition-colors hover:bg-foreground/[0.03] animate-fade-in-up" style={staggerStyle(i)}>
              <div
                className="flex items-center gap-3 rounded-lg px-4 py-3 cursor-pointer"
                onClick={() => toggle(p.id)}
              >
                <span className="text-muted-foreground flex-shrink-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                {p.icon_url ? (
                  <span
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-foreground/5"
                    style={{ backgroundColor: p.color || undefined }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.icon_url} alt="" className="h-full w-full object-cover" />
                  </span>
                ) : p.icon ? (
                  <span className="flex-shrink-0 text-lg leading-none">{p.icon}</span>
                ) : (
                  <PortalDefaultIcon
                    className="h-5 w-5 flex-shrink-0 text-muted-foreground"
                    style={{ color: p.color || undefined }}
                  />
                )}
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                  <span className="min-w-0 truncate font-medium text-sm">{p.name}</span>
                  {/* Type and size as one muted line, not a pill. */}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {TYPE_LABELS[p.type]} · {memberCount(p)} member{memberCount(p) === 1 ? "" : "s"}
                  </span>
                </div>
                {adminNames.length > 0 && (
                  <span
                    className="hidden sm:block min-w-0 max-w-[45%] truncate text-right text-[11px] text-muted-foreground/60"
                    title={adminNames.join(", ")}
                  >
                    {adminNames.join(", ")}
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePortal(p); }}
                  aria-label={`Delete ${p.name}`}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  <X size={15} />
                </button>
              </div>
              {isOpen && (
                // Opens instantly (height grows in); the roster fills in when
                // it arrives, skeleton rows until then.
                <div className="grid animate-expand">
                <div className="min-h-0 overflow-hidden">
                <div className="mx-1 mb-1 flex flex-col gap-5 rounded-lg surface px-10 pb-4 pt-3">
                  {p.description && <p className="break-words text-sm text-muted-foreground">{p.description}</p>}

                  {/* Project portals derive members from the linked project
                      (locked); explicit extras are editable. */}
                  <RosterList
                    label="Members"
                    expectedCount={p.member_count}
                    rows={
                      p.members?.map((m) => ({
                        id: m.user_id,
                        name: m.name,
                        crown: m.is_admin,
                        owner: m.owner,
                        locked: m.locked,
                        note: m.locked ? (m.owner ? "owner" : "via project") : undefined,
                      })) ?? null
                    }
                    crownTitle={(r) => (r.crown ? "Admin — click to remove" : "Make admin")}
                    onToggleCrown={(r) => {
                      const m = p.members?.find((x) => x.user_id === r.id);
                      if (m) toggleAdmin(p, m);
                    }}
                    onRemove={(r) => {
                      const m = p.members?.find((x) => x.user_id === r.id);
                      if (m) removeMember(p, m);
                    }}
                    addControl={
                      <AddMemberPicker
                        options={availableMembers}
                        onAdd={(m) => addMember(p, m)}
                        filters={memberFilters}
                        side="right"
                        trigger={
                          <button aria-label={`Add member to ${p.name}`} className="text-muted-foreground hover:text-foreground transition-colors">
                            <PlusCircle size={14} />
                          </button>
                        }
                      />
                    }
                  />

                  {/* Auto-assigned roles: everyone with the role joins the portal;
                      the crown sets the tier that mapping grants. */}
                  <RosterList
                    label="Roles"
                    person={false}
                    rows={p.roles.map((r) => ({ id: r.id, name: r.role_name, crown: r.is_admin }))}
                    emptyText="No roles. Anyone with a mapped role is auto-added at the chosen tier."
                    crownTitle={(r) => (r.crown ? "Admins — click to make members" : "Make this role admins")}
                    onToggleCrown={(r) => {
                      const role = p.roles.find((x) => x.id === r.id);
                      if (role) toggleRoleAdmin(p, role);
                    }}
                    onRemove={(r) => {
                      const role = p.roles.find((x) => x.id === r.id);
                      if (role) removeRole(p, role);
                    }}
                    addControl={
                      <CommandPicker
                        options={availableRoles.map((r) => ({ value: String(r.id), label: r.role_name }))}
                        onSelect={(id) => {
                          const r = availableRoles.find((x) => String(x.id) === id);
                          if (r) addRole(p, r);
                        }}
                        searchPlaceholder="Search roles…"
                        emptyText="No roles left to add"
                        contentClassName="w-56"
                      >
                        <button aria-label={`Add role to ${p.name}`} className="text-muted-foreground hover:text-foreground transition-colors">
                          <PlusCircle size={14} />
                        </button>
                      </CommandPicker>
                    }
                  />
                </div>
                </div>
                </div>
              )}
            </div>
          );
        })}
        {shownPortals.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {portals.length === 0 ? "No portals yet." : "No portals match."}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit portal</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {editingIsProject ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className="h-12 w-12 flex-shrink-0 rounded-md flex items-center justify-center overflow-hidden bg-muted"
                    style={{ backgroundColor: fields.color || undefined }}
                  >
                    {fields.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fields.iconUrl} alt="" className="h-full w-full object-cover" />
                    ) : fields.icon ? (
                      <span className="text-2xl leading-none">{fields.icon}</span>
                    ) : (
                      <PortalDefaultIcon className="h-6 w-6 text-muted-foreground" style={{ color: fields.color || undefined }} />
                    )}
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-medium text-sm">{fields.name}</span>
                    {fields.description && <span className="text-xs text-muted-foreground">{fields.description}</span>}
                    {fields.color && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                        <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: fields.color }} />
                        {fields.color}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Name, icon, colour and description are managed by the linked project. Use{" "}
                  <span className="font-medium">Edit project</span> below to change them.
                </p>
              </div>
            ) : (
              <>
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
              </>
            )}
            {/* Linked project — edit the underlying project's details. */}
            {editingPortal?.type === "project" && editingPortal.project_id && (
              <div className="flex items-center justify-between gap-2 pt-2">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Project</span>
                  <span className="text-xs text-muted-foreground">Edit the linked project&apos;s details.</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => setProjectEditOpen(true)}>
                  <Pencil size={14} /> Edit project
                </Button>
              </div>
            )}
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {editingIsProject ? "Close" : "Cancel"}
              </Button>
              {!editingIsProject && (
                <Button onClick={saveEdit}>
                  Save
                </Button>
              )}
            </div>
          </div>

          {editingPortal?.type === "project" && editingPortal.project_id && (
            <ProjectEditDialog
              projectId={editingPortal.project_id}
              open={projectEditOpen}
              onOpenChange={setProjectEditOpen}
              onSaved={() => loadPortals()}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
