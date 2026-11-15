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
import { IconPicker } from "@/components/icon-picker";
import { ColorPicker } from "@/components/color-picker";
import { uploadProjectIcon } from "@/lib/project-icon-upload";
import { PanelListSkeleton } from "@/components/skeletons";

import { ProjectQuestionsDialog } from "@/components/project-questions-dialog";
import { type Difficulty, DIFFICULTIES, DIFFICULTY_LABELS } from "@/lib/projects";
import { AddMemberPicker, useAddMemberFilters } from "@/components/add-member-picker";
import { familyLabel, NO_FAMILY_LABEL, useFamilyOptions } from "@/lib/use-families";

import { RosterList } from "@/components/roster-list";
import { useConfirm } from "@/components/ui/use-confirm";
import { staggerStyle } from "@/lib/motion";
import { optimistic } from "@/lib/optimistic";

import { Disclosure } from "@/components/ui/disclosure";

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
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  family_id: string | null;
  /** Null until the row is expanded; the roster loads lazily. */
  members: ProjectMember[] | null;
  member_count: number;
};

const memberCount = (p: Project) => p.members?.length ?? p.member_count;

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
  icon: string;
  iconUrl: string | null;
  color: string;
  // "" means no family. Only exec can change this — the 0103 trigger rejects it
  // for anyone else — and this panel is exec-only, so there's no gate here.
  familyId: string;
};
const EMPTY_FIELDS: ProjectFields = {
  name: "",
  client: "",
  description: "",
  type: "launch",
  difficulty: "",
  estimated_members: "",
  num_subteams: "",
  icon: "",
  iconUrl: null,
  color: "",
  familyId: "",
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
  const memberFilters = useAddMemberFilters(true);
  const [query, setQuery] = useState("");
  const { ask, dialog: confirmDialog } = useConfirm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<ProjectFields>(EMPTY_FIELDS);
  // Deferred icon image (create flow only): preview URL lives in fields.iconUrl,
  // the blob is uploaded once the project row — and thus its id — exists.
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const families = useFamilyOptions();

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

  // Rows first, details lazy: the roster loads the first time a row opens.
  const loadRoster = (id: string) => {
    fetch(`/api/admin/projects/${id}/members`)
      .then((r) => r.json())
      .then((rows) => {
        if (Array.isArray(rows)) setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, members: rows } : p)));
      })
      .catch(() => {});
  };
  // The fetch starts outside the state updater (React may run updaters twice).
  const toggle = (id: string) => {
    const opening = !expanded.has(id);
    if (opening && projects.find((p) => p.id === id)?.members === null) loadRoster(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = () => {
    setEditingId(null);
    setFields(EMPTY_FIELDS);
    setIconBlob(null);
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
      icon: p.icon ?? "",
      iconUrl: p.icon_url,
      color: p.color ?? "",
      familyId: p.family_id ?? "",
    });
    setIconBlob(null);
    setFormError(null);
    setDialogOpen(true);
  };

  // Optimistic edits: the list changes at once, the write runs behind it, and
  // a refusal restores the list snapshot and toasts (with Retry).
  const mutate = (
    label: string,
    key: string,
    next: (prev: Project[]) => Project[],
    commit: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>,
  ) => {
    const before = projects;
    void optimistic({ label, key, apply: () => setProjects(next), rollback: () => setProjects(before), commit, requireRows: true });
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
    const base = {
      name,
      client: client || null,
      description: fields.description.trim() || null,
      type: fields.type,
      difficulty: fields.difficulty || null,
      estimated_members: toIntOrNull(fields.estimated_members),
      num_subteams: toIntOrNull(fields.num_subteams),
      icon: fields.icon.trim() || null,
      color: fields.color.trim() || null,
      family_id: fields.familyId || null,
    };
    const SELECT =
      "id, name, client, description, type, difficulty, estimated_members, num_subteams, icon, icon_url, color, family_id";

    if (editingId) {
      // Edit uses immediate icon upload, so fields.iconUrl is already a real URL.
      // Optimistic: applied and closed at once, restored if refused.
      const id = editingId;
      const payload = { ...base, icon_url: fields.iconUrl || null };
      setSaving(false);
      setDialogOpen(false);
      mutate(
        "project",
        `project:${id}`,
        (prev) => prev.map((p) => (p.id === id ? { ...p, ...payload } : p)),
        () => supabase.from("projects").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id).select("id"),
      );
      return;
    } else {
      // Create still waits: the new row's id is needed for the deferred icon
      // upload and for every edit made to it afterwards.
      const { data, error: insertError } = await supabase
        .from("projects")
        .insert(base)
        .select(SELECT)
        .single();

      if (insertError) { setFormError(insertError.message); setSaving(false); return; }
      let created = data;

      // Deferred icon image: upload now that the project (and its id) exists.
      if (iconBlob) {
        try {
          const url = await uploadProjectIcon(supabase, created.id, iconBlob);
          await supabase.from("projects").update({ icon_url: url }).eq("id", created.id);
          created = { ...created, icon_url: url };
        } catch (uploadErr) {
          setFormError(uploadErr instanceof Error ? uploadErr.message : "Icon upload failed. Try again.");
          setSaving(false);
          return;
        }
      }
      setProjects((prev) => [...prev, { ...created, members: [], member_count: 0 }]);
    }

    setSaving(false);
    setDialogOpen(false);
  };

  const deleteProject = (project: Project) => {
    ask({
      title: `Delete ${project.name}?`,
      description: "This also removes its member roster.",
      confirmLabel: "Delete",
      destructive: true,
      run: () => {
        const supabase = createClient();
        mutate("project deletion", `project:${project.id}`, (prev) => prev.filter((p) => p.id !== project.id), () =>
          supabase.from("projects").delete().eq("id", project.id).select("id"),
        );
      },
    });
  };

  const patchProject = (projectId: string, fn: (p: Project) => Project) => (prev: Project[]) =>
    prev.map((p) => (p.id === projectId ? fn(p) : p));

  const addMember = (project: Project, member: MemberOption) => {
    const supabase = createClient();
    mutate(
      "member",
      `project-member:${project.id}:${member.user_id}`,
      patchProject(project.id, (p) => ({
        ...p,
        members: [...(p.members ?? []), { ...member, is_pm: false }],
        member_count: p.member_count + 1,
      })),
      () => supabase.from("project_members").insert({ project_id: project.id, user_id: member.user_id, is_pm: false }).select("user_id"),
    );
  };

  const removeMember = (project: Project, member: ProjectMember) => {
    const supabase = createClient();
    mutate(
      "member",
      `project-member:${project.id}:${member.user_id}`,
      patchProject(project.id, (p) => ({
        ...p,
        members: (p.members ?? []).filter((m) => m.user_id !== member.user_id),
        member_count: Math.max(0, p.member_count - 1),
      })),
      () =>
        supabase.from("project_members").delete().eq("project_id", project.id).eq("user_id", member.user_id).select("user_id"),
    );
  };

  const togglePm = (project: Project, member: ProjectMember) => {
    const nextIsPm = !member.is_pm;
    ask({
      title: nextIsPm ? `Make ${member.name} PM of ${project.name}?` : `Remove ${member.name} as PM of ${project.name}?`,
      confirmLabel: nextIsPm ? "Make PM" : "Remove PM",
      destructive: !nextIsPm,
      run: () => applyTogglePm(project, member, nextIsPm),
    });
  };
  const applyTogglePm = (project: Project, member: ProjectMember, nextIsPm: boolean) => {
    const supabase = createClient();
    mutate(
      "PM status",
      `project-pm:${project.id}:${member.user_id}`,
      patchProject(project.id, (p) => ({
        ...p,
        members: (p.members ?? []).map((m) => (m.user_id === member.user_id ? { ...m, is_pm: nextIsPm } : m)),
      })),
      () =>
        supabase
          .from("project_members")
          .update({ is_pm: nextIsPm })
          .eq("project_id", project.id)
          .eq("user_id", member.user_id)
          .select("user_id"),
    );
  };

  if (loading) return <PanelListSkeleton />;
  if (error) return <div className="py-8 text-sm text-destructive">{error}</div>;

  const renderRow = (p: Project, i: number) => {
    const isOpen = expanded.has(p.id);
    const available = members.filter((m) => !(p.members ?? []).some((pm) => pm.user_id === m.user_id));
    const meta = [
      p.difficulty ? DIFFICULTY_LABELS[p.difficulty] : null,
      p.estimated_members != null ? `~${p.estimated_members} members` : null,
      p.num_subteams != null ? `${p.num_subteams} subteam${p.num_subteams === 1 ? "" : "s"}` : null,
    ].filter(Boolean) as string[];
    return (
      <div key={p.id} className="rounded-lg transition-colors hover:bg-foreground/[0.03] animate-fade-in-up" style={staggerStyle(i)}>
        <div
          className="flex items-center gap-3 rounded-lg px-4 py-3 cursor-pointer"
          onClick={() => toggle(p.id)}
        >
          <span className="text-muted-foreground flex-shrink-0">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <span className="min-w-0 truncate font-medium text-sm">{p.name}</span>
            {/* Client as muted text, family as its colour dot + name: no pills. */}
            {p.client && <span className="min-w-0 max-w-[10rem] truncate text-xs text-muted-foreground">{p.client}</span>}
            {p.family_id && (
              <span className="inline-flex min-w-0 max-w-[10rem] items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: families.find((f) => f.id === p.family_id)?.color ?? "hsl(var(--muted-foreground))" }}
                />
                <span className="truncate">{familyLabel(families, p.family_id)}</span>
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {memberCount(p)} member{memberCount(p) === 1 ? "" : "s"}
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(p); }}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); deleteProject(p); }}
            aria-label={`Delete ${p.name}`}
            className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
          >
            <X size={15} />
          </button>
        </div>
        {isOpen && (
          // Opens instantly; the roster fills in when it arrives.
          <div className="grid animate-expand">
          <div className="min-h-0 overflow-hidden">
          <div className="mx-1 mb-1 flex flex-col gap-3 rounded-lg surface px-10 pb-4 pt-3">
            {p.description && <p className="break-words text-sm text-muted-foreground">{p.description}</p>}
            {meta.length > 0 && (
              <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
            )}
            <RosterList
              label="Members"
              rows={p.members?.map((m) => ({ id: m.user_id, name: m.name, crown: m.is_pm })) ?? null}
              crownTitle={(r) => (r.crown ? "PM — click to remove" : "Make PM")}
              onToggleCrown={(r) => {
                const m = p.members?.find((x) => x.user_id === r.id);
                if (m) togglePm(p, m);
              }}
              onRemove={(r) => {
                const m = p.members?.find((x) => x.user_id === r.id);
                if (m) removeMember(p, m);
              }}
              addControl={
                <AddMemberPicker
                  options={available}
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
          </div>
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
      <div className="flex flex-col gap-0.5">
        {list.map((p, i) => renderRow(p, i))}
        {list.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No projects in this track yet.</div>
        )}
      </div>
    </div>
  );

  // Search filters before the Studio/Launch split; a track with no matches
  // hides while searching.
  const q = query.trim().toLowerCase();
  const matching = q
    ? projects.filter((p) =>
        [p.name, p.client ?? "", p.description ?? "", p.family_id ? familyLabel(families, p.family_id) : ""].some((t) =>
          t.toLowerCase().includes(q),
        ),
      )
    : projects;
  const studioProjects = matching.filter((p) => p.type === "studio");
  const launchProjects = matching.filter((p) => p.type === "launch");

  return (
    <div className="flex flex-col gap-6">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects..."
          aria-label="Search projects"
          className="max-w-xs"
        />
        <Button size="sm" onClick={openCreate}>
          <PlusCircle size={15} /> New project
        </Button>
      </div>

      {(!q || studioProjects.length > 0) && renderSection(TYPE_LABELS.studio, studioProjects)}
      {(!q || launchProjects.length > 0) && renderSection(TYPE_LABELS.launch, launchProjects)}
      {q && matching.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No projects match.</p>
      )}

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
              <Label>Family</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                    {familyLabel(families, fields.familyId)}
                    <ChevronDown size={14} className="text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] max-h-72 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => setFields((f) => ({ ...f, familyId: "" }))}>
                    {NO_FAMILY_LABEL}
                  </DropdownMenuItem>
                  {families.map((fam) => (
                    <DropdownMenuItem
                      key={fam.id}
                      onSelect={() => setFields((f) => ({ ...f, familyId: fam.id }))}
                    >
                      {fam.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {families.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No families yet — create them in the Families tab.
                </p>
              )}
              {fields.familyId && (
                <p className="text-xs text-muted-foreground">
                  Scoreboard points for this project count toward{" "}
                  {familyLabel(families, fields.familyId)}.
                </p>
              )}
            </div>
            {/* Client is required for OP Studio, so it stays in view there. */}
            {fields.type === "studio" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="project-client">Client<span className="text-destructive"> *</span></Label>
                <Input
                  id="project-client"
                  value={fields.client}
                  onChange={(e) => setFields((f) => ({ ...f, client: e.target.value }))}
                  placeholder="Required for OP Studio"
                />
              </div>
            )}
            {/* Everything else is optional: open when editing a project that has any of it. */}
            <Disclosure
              key={editingId ?? "new"}
              hint="icon, colour, size, description"
              defaultOpen={!!(fields.icon || fields.iconUrl || fields.color || fields.difficulty || fields.estimated_members || fields.num_subteams || fields.description || (fields.type !== "studio" && fields.client))}
            >
              {fields.type !== "studio" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="project-client">Client</Label>
                  <Input
                    id="project-client"
                    value={fields.client}
                    onChange={(e) => setFields((f) => ({ ...f, client: e.target.value }))}
                  />
                </div>
              )}
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 w-28">
                  <Label>Icon</Label>
                  <IconPicker
                    value={fields.icon}
                    onChange={(v) => setFields((f) => ({ ...f, icon: v }))}
                    imageUrl={fields.iconUrl}
                    onImageChange={(url) => setFields((f) => ({ ...f, iconUrl: url }))}
                    onImageBlob={setIconBlob}
                    projectId={editingId ?? undefined}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <Label>Accent color</Label>
                  <ColorPicker value={fields.color} onChange={(v) => setFields((f) => ({ ...f, color: v }))} />
                </div>
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
            </Disclosure>
            {editingId && (
              <div className="flex items-center justify-between gap-2 pt-2">
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
