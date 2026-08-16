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
import { PanelListSkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { ProjectQuestionsDialog } from "@/components/project-questions-dialog";
import { type Difficulty, DIFFICULTIES, DIFFICULTY_LABELS } from "@/lib/projects";

type ProjectMember = { user_id: string; name: string; is_pm: boolean };

type ProjectType = "studio" | "launch";

const TYPE_LABELS: Record<ProjectType, string> = {
  studio: "OP Studio",
  launch: "OP Launch",
};

type Project = {
  id: string;
  name: string;
  client: string | null;
  description: string | null;
  type: ProjectType;
  difficulty: Difficulty | null;
  estimated_members: number | null;
  num_subteams: number | null;
  members: ProjectMember[];
};

export type MemberOption = { user_id: string; name: string };

// Numeric fields are held as strings while editing, then parsed on save.
type ProjectFields = {
  name: string;
  client: string;
  description: string;
  type: ProjectType;
  difficulty: Difficulty | "";
  estimated_members: string;
  num_subteams: string;
};
const EMPTY_FIELDS: ProjectFields = {
  name: "",
  client: "",
  description: "",
  type: "launch",
  difficulty: "",
  estimated_members: "",
  num_subteams: "",
};

const toIntOrNull = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

type Props = { members: MemberOption[] };

export function ProjectsPanel({ members }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<ProjectFields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [questionsOpen, setQuestionsOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/projects")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setProjects(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load."); setLoading(false); });
  }, []);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openCreate = () => {
    setEditingId(null);
    setFields(EMPTY_FIELDS);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditingId(p.id);
    setFields({
      name: p.name,
      client: p.client ?? "",
      description: p.description ?? "",
      type: p.type,
      difficulty: p.difficulty ?? "",
      estimated_members: p.estimated_members != null ? String(p.estimated_members) : "",
      num_subteams: p.num_subteams != null ? String(p.num_subteams) : "",
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const saveProject = async () => {
    const name = fields.name.trim();
    if (!name) { setFormError("Name is required."); return; }
    const client = fields.client.trim();
    if (fields.type === "studio" && !client) {
      setFormError("OP Studio projects require a client.");
      return;
    }

    setSaving(true);
    setFormError(null);
    const supabase = createClient();
    const payload = {
      name,
      client: client || null,
      description: fields.description.trim() || null,
      type: fields.type,
      difficulty: fields.difficulty || null,
      estimated_members: toIntOrNull(fields.estimated_members),
      num_subteams: toIntOrNull(fields.num_subteams),
    };

    if (editingId) {
      const { error: updateError } = await supabase
        .from("projects")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", editingId);

      if (updateError) { setFormError(updateError.message); setSaving(false); return; }
      setProjects((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...payload } : p)));
    } else {
      const { data, error: insertError } = await supabase
        .from("projects")
        .insert(payload)
        .select("id, name, client, description, type, difficulty, estimated_members, num_subteams")
        .single();

      if (insertError) { setFormError(insertError.message); setSaving(false); return; }
      setProjects((prev) => [...prev, { ...data, members: [] }]);
    }

    setSaving(false);
    setDialogOpen(false);
  };

  const deleteProject = async (id: string) => {
    if (!confirm("Delete this project? This also removes its member roster.")) return;
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("projects").delete().eq("id", id);
    if (deleteError) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const addMember = async (project: Project, member: MemberOption) => {
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("project_members")
      .insert({ project_id: project.id, user_id: member.user_id, is_pm: false });

    if (insertError) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === project.id ? { ...p, members: [...p.members, { ...member, is_pm: false }] } : p,
      ),
    );
  };

  const removeMember = async (project: Project, member: ProjectMember) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", project.id)
      .eq("user_id", member.user_id);

    if (deleteError) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === project.id ? { ...p, members: p.members.filter((m) => m.user_id !== member.user_id) } : p,
      ),
    );
  };

  const togglePm = async (project: Project, member: ProjectMember) => {
    const nextIsPm = !member.is_pm;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("project_members")
      .update({ is_pm: nextIsPm })
      .eq("project_id", project.id)
      .eq("user_id", member.user_id);

    if (updateError) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === project.id
          ? { ...p, members: p.members.map((m) => (m.user_id === member.user_id ? { ...m, is_pm: nextIsPm } : m)) }
          : p,
      ),
    );
  };

  if (loading) return <PanelListSkeleton />;
  if (error) return <div className="py-8 text-sm text-red-500">{error}</div>;

  const renderRow = (p: Project, i: number) => {
    const isOpen = expanded.has(p.id);
    const available = members.filter((m) => !p.members.some((pm) => pm.user_id === m.user_id));
    const meta = [
      p.difficulty ? DIFFICULTY_LABELS[p.difficulty] : null,
      p.estimated_members != null ? `~${p.estimated_members} members` : null,
      p.num_subteams != null ? `${p.num_subteams} subteam${p.num_subteams === 1 ? "" : "s"}` : null,
    ].filter(Boolean) as string[];
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
            {p.client && (
              <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium">
                {p.client}
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
            onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
            className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
          >
            <X size={15} />
          </button>
        </div>
        {isOpen && (
          <div className="px-11 pb-4 pt-3 flex flex-col gap-3 bg-accent/20">
            {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
            {meta.length > 0 && (
              <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
            )}
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
                      <PersonName userId={m.user_id} name={m.name} className="flex-1" />
                      <button
                        onClick={() => togglePm(p, m)}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          m.is_pm
                            ? "bg-foreground text-background"
                            : "bg-foreground/10 text-foreground hover:bg-foreground/20"
                        }`}
                      >
                        PM
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
  };

  const renderSection = (title: string, list: Project[]) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h2>
        <span className="text-[10px] font-normal text-muted-foreground/60">({list.length})</span>
      </div>
      <div className="border rounded-lg overflow-hidden">
        {list.map((p, i) => renderRow(p, i))}
        {list.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No projects in this track yet.</div>
        )}
      </div>
    </div>
  );

  const studioProjects = projects.filter((p) => p.type === "studio");
  const launchProjects = projects.filter((p) => p.type === "launch");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          <PlusCircle size={15} /> New project
        </Button>
      </div>

      {renderSection(TYPE_LABELS.studio, studioProjects)}
      {renderSection(TYPE_LABELS.launch, launchProjects)}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit project" : "New project"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={fields.name}
                onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Type</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                    {TYPE_LABELS[fields.type]}
                    <ChevronDown size={14} className="text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                  {(Object.keys(TYPE_LABELS) as ProjectType[]).map((t) => (
                    <DropdownMenuItem key={t} onSelect={() => setFields((f) => ({ ...f, type: t }))}>
                      {TYPE_LABELS[t]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="project-client">Client{fields.type === "studio" && <span className="text-red-500"> *</span>}</Label>
              <Input
                id="project-client"
                value={fields.client}
                onChange={(e) => setFields((f) => ({ ...f, client: e.target.value }))}
                placeholder={fields.type === "studio" ? "Required for OP Studio" : "Optional"}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <Label>Difficulty</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                      {fields.difficulty ? DIFFICULTY_LABELS[fields.difficulty] : "—"}
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setFields((f) => ({ ...f, difficulty: "" }))}>—</DropdownMenuItem>
                    {DIFFICULTIES.map((d) => (
                      <DropdownMenuItem key={d} onSelect={() => setFields((f) => ({ ...f, difficulty: d }))}>
                        {DIFFICULTY_LABELS[d]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="project-members">Members</Label>
                <Input
                  id="project-members"
                  type="number"
                  min={0}
                  value={fields.estimated_members}
                  onChange={(e) => setFields((f) => ({ ...f, estimated_members: e.target.value }))}
                  placeholder="Est."
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="project-subteams">Subteams</Label>
                <Input
                  id="project-subteams"
                  type="number"
                  min={0}
                  value={fields.num_subteams}
                  onChange={(e) => setFields((f) => ({ ...f, num_subteams: e.target.value }))}
                  placeholder="#"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="project-description">Description</Label>
              <textarea
                id="project-description"
                value={fields.description}
                onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="border rounded-md px-3 py-2 text-sm w-full resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {editingId && (
              <div className="flex items-center justify-between gap-2 border-t pt-4">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Application questions</span>
                  <span className="text-xs text-muted-foreground">Custom questions applicants answer for this project.</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => setQuestionsOpen(true)}>
                  Manage
                </Button>
              </div>
            )}
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveProject} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>

          {editingId && (
            <ProjectQuestionsDialog projectId={editingId} open={questionsOpen} onOpenChange={setQuestionsOpen} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
