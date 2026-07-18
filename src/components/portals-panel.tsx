"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, PlusCircle, Pencil, X } from "lucide-react";
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

export const PORTAL_TYPES = [
  { value: "project", label: "Projects" },
  { value: "committee", label: "Committees" },
  { value: "chapter", label: "Chapters" },
  { value: "cohort", label: "Cohorts" },
] as const;

export type PortalType = (typeof PORTAL_TYPES)[number]["value"];

type PortalMember = { user_id: string; name: string; role: "member" | "lead" };

type Portal = {
  id: string;
  type: PortalType;
  name: string;
  description: string | null;
  metadata: { client?: string };
  members: PortalMember[];
};

export type MemberOption = { user_id: string; name: string };

type PortalFields = { type: PortalType; name: string; client: string; description: string };
const emptyFields = (type: PortalType): PortalFields => ({ type, name: "", client: "", description: "" });

type Props = { members: MemberOption[] };

export function PortalsPanel({ members }: Props) {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<PortalType | "all">("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<PortalFields>(emptyFields("project"));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/portals")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPortals(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load."); setLoading(false); });
  }, []);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = () => {
    setEditingId(null);
    setFields(emptyFields(typeFilter === "all" ? "project" : typeFilter));
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (p: Portal) => {
    setEditingId(p.id);
    setFields({ type: p.type, name: p.name, client: p.metadata.client ?? "", description: p.description ?? "" });
    setFormError(null);
    setDialogOpen(true);
  };

  const savePortal = async () => {
    const name = fields.name.trim();
    if (!name) { setFormError("Name is required."); return; }

    setSaving(true);
    setFormError(null);
    const supabase = createClient();
    const client = fields.client.trim();
    const payload = {
      type: fields.type,
      name,
      description: fields.description.trim() || null,
      metadata: client ? { client } : {},
    };

    if (editingId) {
      const { error: updateError } = await supabase
        .from("portals")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", editingId);

      if (updateError) { setFormError(updateError.message); setSaving(false); return; }
      setPortals((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...payload } : p)));
    } else {
      const { data, error: insertError } = await supabase
        .from("portals")
        .insert(payload)
        .select("id, type, name, description, metadata")
        .single();

      if (insertError) { setFormError(insertError.message); setSaving(false); return; }
      setPortals((prev) => [...prev, { ...data, members: [] }]);
    }

    setSaving(false);
    setDialogOpen(false);
  };

  const deletePortal = async (id: string) => {
    if (!confirm("Delete this portal? This also removes its member roster.")) return;
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("portals").delete().eq("id", id);
    if (deleteError) return;
    setPortals((prev) => prev.filter((p) => p.id !== id));
  };

  const addMember = async (portal: Portal, member: MemberOption) => {
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("portal_members")
      .insert({ portal_id: portal.id, user_id: member.user_id, role: "member" });

    if (insertError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id ? { ...p, members: [...p.members, { ...member, role: "member" }] } : p,
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

  const toggleLead = async (portal: Portal, member: PortalMember) => {
    const nextRole = member.role === "lead" ? "member" : "lead";
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("portal_members")
      .update({ role: nextRole })
      .eq("portal_id", portal.id)
      .eq("user_id", member.user_id);

    if (updateError) return;
    setPortals((prev) =>
      prev.map((p) =>
        p.id === portal.id
          ? { ...p, members: p.members.map((m) => (m.user_id === member.user_id ? { ...m, role: nextRole } : m)) }
          : p,
      ),
    );
  };

  if (loading) return <div className="py-8 text-sm text-muted-foreground">Loading...</div>;
  if (error) return <div className="py-8 text-sm text-red-500">{error}</div>;

  const filtered = typeFilter === "all" ? portals : portals.filter((p) => p.type === typeFilter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1">
          {(["all", ...PORTAL_TYPES.map((t) => t.value)] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                typeFilter === t
                  ? "bg-foreground text-background"
                  : "bg-foreground/10 text-foreground hover:bg-foreground/20"
              }`}
            >
              {t === "all" ? "All" : PORTAL_TYPES.find((pt) => pt.value === t)?.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusCircle size={15} /> New portal
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {filtered.map((p, i) => {
          const isOpen = expanded.has(p.id);
          const available = members.filter((m) => !p.members.some((pm) => pm.user_id === m.user_id));
          return (
            <div key={p.id} className={i > 0 ? "border-t" : ""}>
              <div
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer"
                onClick={() => toggle(p.id)}
              >
                <span className="text-muted-foreground flex-shrink-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium capitalize">
                    {p.type}
                  </span>
                  {p.metadata.client && (
                    <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium">
                      {p.metadata.client}
                    </span>
                  )}
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
                <div className="px-11 pb-4 pt-1 flex flex-col gap-3 bg-accent/20">
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Members
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="text-muted-foreground hover:text-foreground transition-colors">
                            <PlusCircle size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {available.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              No members left to add
                            </div>
                          ) : (
                            available.map((m) => (
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
                            <span className="flex-1">{m.name}</span>
                            <button
                              onClick={() => toggleLead(p, m)}
                              className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                                m.role === "lead"
                                  ? "bg-foreground text-background"
                                  : "bg-foreground/10 text-foreground hover:bg-foreground/20"
                              }`}
                            >
                              Lead
                            </button>
                            <button
                              onClick={() => removeMember(p, m)}
                              className="text-muted-foreground hover:text-red-500 transition-colors"
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
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No portals yet.</div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit portal" : "New portal"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="portal-type">Type</Label>
              <select
                id="portal-type"
                value={fields.type}
                onChange={(e) => setFields((f) => ({ ...f, type: e.target.value as PortalType }))}
                className="border rounded-md px-3 py-2 text-sm w-full bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {PORTAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label.replace(/s$/, "")}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="portal-name">Name</Label>
              <Input
                id="portal-name"
                value={fields.name}
                onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            {fields.type === "project" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="portal-client">Client</Label>
                <Input
                  id="portal-client"
                  value={fields.client}
                  onChange={(e) => setFields((f) => ({ ...f, client: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            )}
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
              <Button onClick={savePortal} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
