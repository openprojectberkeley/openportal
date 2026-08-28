"use client";

import { createClient } from "@/lib/supabase/client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Pencil, X, AlertTriangle, Coffee, GripVertical, ChevronDown, Plus } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { ApplicationPageSkeleton } from "@/components/skeletons";
import { ProjectApplicationModal } from "@/components/project-application-modal";
import { useRoleSim } from "@/components/role-simulation-provider";
import { type Difficulty, DIFFICULTY_LABELS } from "@/lib/projects";
import { readableTextColor, DEFAULT_ACCENT } from "@/lib/portal-color";

type ProjectType = "studio" | "launch";

type Project = {
  id: string;
  name: string;
  type: ProjectType;
  client: string | null;
  description: string | null;
  difficulty: Difficulty | null;
  estimated_members: number | null;
  num_subteams: number | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
};

type Pm = { user_id: string; name: string };

const TYPE_LABELS: Record<ProjectType, string> = {
  studio: "OP Studio",
  launch: "OP Launch",
};

const RANK_COUNT = 7;

const metaLine = (p: Project) =>
  [
    p.difficulty ? DIFFICULTY_LABELS[p.difficulty] : null,
    p.estimated_members != null ? `~${p.estimated_members} members` : null,
    p.num_subteams != null ? `${p.num_subteams} subteam${p.num_subteams === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export default function ApplicationPage() {
  const { isBoardOrExec } = useRoleSim();
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  // No application period is currently open — the flow is gated shut.
  const [closed, setClosed] = useState(false);
  // Returning members (active) may apply to OP Studio; first-timers (inactive)
  // are limited to OP Launch. Board/exec (staff) are always eligible.
  const [memberActive, setMemberActive] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pmMap, setPmMap] = useState<Record<string, Pm[]>>({});
  const [chattedWith, setChattedWith] = useState<Set<string>>(new Set());

  // Draft application state.
  const appIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  // The open period this application belongs to (stamped on the draft).
  const periodIdRef = useRef<string | null>(null);
  const [ranked, setRanked] = useState<string[]>([]);
  const [rankingIdByProject, setRankingIdByProject] = useState<Record<string, string>>({});
  const [completedByProject, setCompletedByProject] = useState<Record<string, boolean>>({});

  const [modalProject, setModalProject] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The id currently being dragged, so the DragOverlay can render a 1:1 preview.
  const [activeId, setActiveId] = useState<string | null>(null);
  // Which zone the pointer is currently over, so we can show a slot preview there.
  const [overArea, setOverArea] = useState<"ranking" | "available" | null>(null);
  // For an incoming available card, the index in `ranked` it would drop into, so
  // the slot preview appears between cards rather than always at the end.
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    userIdRef.current = user.id;

    // Applications can only be built/submitted while a period's status is 'open'
    // (the explicit switch — the start/end window is just an informational
    // schedule). No open period → the flow is closed.
    const { data: openPeriods } = await supabase
      .from("application_periods")
      .select("id")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1);
    const periodId = openPeriods?.[0]?.id ?? null;
    periodIdRef.current = periodId;

    if (!periodId) { setClosed(true); setLoading(false); return; }

    const { data: app } = await supabase
      .from("applications")
      .select("id, status")
      .eq("applicant_id", user.id)
      .eq("period_id", periodId)
      .maybeSingle();

    // Already applied this period (submitted, or reviewed accepted/rejected).
    if (app?.status && app.status !== "draft") { setSubmitted(true); setLoading(false); return; }

    const [{ data: projectRows }, { data: pmRows }, { data: chatRows }, { data: memberRow }] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, type, client, description, difficulty, estimated_members, num_subteams, icon, icon_url, color")
        .order("name"),
      supabase
        .from("project_members")
        .select("project_id, members(user_id, preferred_firstname, lastname)")
        .eq("is_pm", true),
      supabase
        .from("coffee_chats")
        .select("member_id")
        .eq("applicant_id", user.id)
        .eq("complete", true),
      supabase.from("members").select("active").eq("user_id", user.id).maybeSingle(),
    ]);

    setMemberActive(!!memberRow?.active);

    const map: Record<string, Pm[]> = {};
    for (const row of pmRows ?? []) {
      const m = row.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
      if (!m) continue;
      const name = [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "a PM";
      (map[row.project_id] ??= []).push({ user_id: m.user_id, name });
    }

    setProjects((projectRows ?? []) as Project[]);
    setPmMap(map);
    setChattedWith(new Set((chatRows ?? []).map((c) => c.member_id)));

    // Hydrate an existing draft's ranking.
    if (app?.id) {
      appIdRef.current = app.id;
      const { data: rankRows } = await supabase
        .from("application_rankings")
        .select("id, project_id, rank, completed")
        .eq("application_id", app.id)
        .eq("ranked", true)
        .order("rank");
      const rk: string[] = [];
      const idMap: Record<string, string> = {};
      const doneMap: Record<string, boolean> = {};
      for (const r of rankRows ?? []) {
        rk.push(r.project_id as string);
        idMap[r.project_id as string] = r.id as string;
        doneMap[r.project_id as string] = r.completed as boolean;
      }
      setRanked(rk);
      setRankingIdByProject(idMap);
      setCompletedByProject(doneMap);
    }

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ensureApp = async (): Promise<string | null> => {
    if (appIdRef.current) return appIdRef.current;
    const uid = userIdRef.current;
    if (!uid) return null;
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("applications")
      .insert({ applicant_id: uid, period_id: periodIdRef.current })
      .select("id")
      .single();
    if (insertError || !data) {
      // Likely a pre-existing draft (unique applicant_id per period) — fetch it.
      const { data: existing } = await supabase
        .from("applications")
        .select("id")
        .eq("applicant_id", uid)
        .eq("period_id", periodIdRef.current)
        .maybeSingle();
      if (existing) { appIdRef.current = existing.id; return existing.id; }
      return null;
    }
    appIdRef.current = data.id;
    return data.id;
  };

  const syncRanks = async (list: string[], idMap: Record<string, string>) => {
    const supabase = createClient();
    await Promise.all(
      list.map((pid, i) => supabase.from("application_rankings").update({ rank: i + 1 }).eq("id", idMap[pid])),
    );
  };

  const addProject = async (projectId: string, atIndex?: number) => {
    if (ranked.includes(projectId) || ranked.length >= RANK_COUNT) return;
    // First-timers can't rank OP Studio projects (mirrors the RLS gate).
    const proj = projects.find((p) => p.id === projectId);
    if (proj?.type === "studio" && !(memberActive || isBoardOrExec)) return;
    const aId = await ensureApp();
    if (!aId) { setError("Couldn't start your application."); return; }
    const index = atIndex ?? ranked.length;
    const newRanked = [...ranked];
    newRanked.splice(index, 0, projectId);

    const supabase = createClient();

    // A soft-removed row for this project still holds its essay/answers — restore
    // it instead of creating a fresh one (see migration 0021).
    const { data: existing } = await supabase
      .from("application_rankings")
      .select("id, completed")
      .eq("application_id", aId)
      .eq("project_id", projectId)
      .maybeSingle();

    let rid: string;
    let completed = false;
    if (existing) {
      rid = existing.id as string;
      completed = !!existing.completed;
      const { error: updateError } = await supabase
        .from("application_rankings")
        .update({ ranked: true, rank: index + 1, updated_at: new Date().toISOString() })
        .eq("id", rid);
      if (updateError) return;
    } else {
      const { data, error: insertError } = await supabase
        .from("application_rankings")
        .insert({ application_id: aId, project_id: projectId, rank: index + 1, completed: false, ranked: true })
        .select("id")
        .single();
      if (insertError || !data) return;
      rid = data.id as string;
    }

    const nextMap = { ...rankingIdByProject, [projectId]: rid };
    setRankingIdByProject(nextMap);
    setCompletedByProject((p) => ({ ...p, [projectId]: completed }));
    setRanked(newRanked);
    await syncRanks(newRanked, nextMap);
  };

  const removeProject = async (projectId: string) => {
    const rid = rankingIdByProject[projectId];
    const newRanked = ranked.filter((p) => p !== projectId);
    const supabase = createClient();
    // Soft-remove: keep the row (and its essay/answers) so re-adding restores it.
    if (rid) await supabase.from("application_rankings").update({ ranked: false }).eq("id", rid);
    const nextMap = { ...rankingIdByProject };
    delete nextMap[projectId];
    setRankingIdByProject(nextMap);
    setCompletedByProject((p) => { const n = { ...p }; delete n[projectId]; return n; });
    setRanked(newRanked);
    await syncRanks(newRanked, nextMap);
  };

  const reorder = async (newRanked: string[]) => {
    setRanked(newRanked);
    await syncRanks(newRanked, rankingIdByProject);
  };

  const areaOf = (overId: string | null): "ranking" | "available" | null => {
    if (!overId) return null;
    if (overId === "ranked-zone" || overId.startsWith("slot:") || ranked.includes(overId)) return "ranking";
    if (overId === "available-zone" || overId.startsWith("avail:")) return "available";
    return null;
  };

  // Where an incoming available card would land in `ranked`, based on the card it
  // is hovering: before it if the dragged card's center sits above the hovered
  // card's center, otherwise after. Over the empty zone → the end.
  const insertIndexFor = (event: DragOverEvent | DragEndEvent): number => {
    const over = event.over;
    if (!over) return ranked.length;
    const idx = ranked.indexOf(String(over.id));
    if (idx === -1) return ranked.length;
    const activeRect = event.active.rect.current.translated;
    const activeCenterY = activeRect ? activeRect.top + activeRect.height / 2 : 0;
    const overCenterY = over.rect.top + over.rect.height / 2;
    return activeCenterY < overCenterY ? idx : idx + 1;
  };

  const onDragOver = (event: DragOverEvent) => {
    const area = areaOf(event.over ? String(event.over.id) : null);
    setOverArea(area);
    const activeIsAvail = String(event.active.id).startsWith("avail:");
    setOverIndex(activeIsAvail && area === "ranking" ? insertIndexFor(event) : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setOverArea(null);
    setOverIndex(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const area = areaOf(overId);

    if (activeId.startsWith("avail:")) {
      // Only a drop onto the ranking adds it — dropping back over the projects
      // list (or its own area) does nothing. Inserted at the hovered slot,
      // matching the slot preview (falls back to the end).
      if (area === "ranking") addProject(activeId.slice(6), insertIndexFor(event));
      return;
    }

    // A ranked item dropped back over the available list is removed; over the
    // ranking it reorders.
    if (ranked.includes(activeId)) {
      if (area === "available") { removeProject(activeId); return; }
      if (ranked.includes(overId) && activeId !== overId) {
        reorder(arrayMove(ranked, ranked.indexOf(activeId), ranked.indexOf(overId)));
      }
    }
  };

  const projectById = (id: string) => projects.find((p) => p.id === id);
  const studioMet = (projectId: string) => (pmMap[projectId] ?? []).some((pm) => chattedWith.has(pm.user_id));
  const studioBlocked = ranked.filter((id) => projectById(id)?.type === "studio" && !studioMet(id));
  const allCompleted = ranked.length > 0 && ranked.every((id) => completedByProject[id]);
  const canSubmit = ranked.length === RANK_COUNT && allCompleted && studioBlocked.length === 0;

  const submit = async () => {
    if (!canSubmit || !appIdRef.current) return;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    // Drop any soft-removed picks so the submitted application holds only its 7.
    await supabase
      .from("application_rankings")
      .delete()
      .eq("application_id", appIdRef.current)
      .eq("ranked", false);
    const { error: submitError } = await supabase
      .from("applications")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", appIdRef.current);
    if (submitError) { setError(submitError.message); setSubmitting(false); return; }
    setSubmitting(false);
    setSubmitted(true);
  };

  if (loading) return <ApplicationPageSkeleton />;

  if (closed) {
    return (
      <div className="flex flex-1 w-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="h-12 w-12 rounded-full bg-foreground/5 text-foreground/70 flex items-center justify-center">
            <X size={24} />
          </div>
          <h1 className="text-2xl font-bold">Applications are closed</h1>
          <p className="text-sm text-muted-foreground">
            There&apos;s no application period open right now. Check back when the next
            one opens.
          </p>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back home</Link>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex flex-1 w-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="h-12 w-12 rounded-full bg-green-600/10 text-green-700 dark:text-green-400 flex items-center justify-center">
            <Check size={24} />
          </div>
          <h1 className="text-2xl font-bold">Application submitted</h1>
          <p className="text-sm text-muted-foreground">
            Thanks for applying! We&apos;ve received your project rankings and answers.
          </p>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back home</Link>
        </div>
      </div>
    );
  }

  // First-time members (inactive) may only apply to OP Launch; returning members
  // (active) and staff (board/exec) may also apply to OP Studio.
  const studioEligible = memberActive || isBoardOrExec;
  const available = projects.filter((p) => !ranked.includes(p.id));
  const studioAvailable = studioEligible ? available.filter((p) => p.type === "studio") : [];
  const launchAvailable = available.filter((p) => p.type === "launch");
  const full = ranked.length >= RANK_COUNT;
  const activeIsAvail = !!activeId?.startsWith("avail:");
  const activeProject = activeId
    ? projectById(activeIsAvail ? activeId.slice(6) : activeId)
    : null;
  // Slot previews: an available card hovering the ranking previews at the end;
  // a ranked card hovering the projects list previews back in its group.
  const rankingGhost = (activeIsAvail && overArea === "ranking" && !full ? activeProject : null) ?? null;
  const availableGhost =
    (!activeIsAvail && activeId && ranked.includes(activeId) && overArea === "available" ? activeProject : null) ?? null;

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Application</h1>
        <p className="text-sm text-muted-foreground">
          Drag projects into your ranking (top {RANK_COUNT}), then open each to complete its questions.
          Your progress saves automatically.
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragOver={onDragOver}
        onDragEnd={(e) => { setActiveId(null); onDragEnd(e); }}
        onDragCancel={() => { setActiveId(null); setOverArea(null); setOverIndex(null); }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Available projects */}
          <AvailableZone
            studioAvailable={studioAvailable}
            launchAvailable={launchAvailable}
            studioEligible={studioEligible}
            pmMap={pmMap}
            studioMet={studioMet}
            full={full}
            onAdd={addProject}
            ghost={availableGhost}
          />

          {/* Ranking */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your ranking</h2>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{ranked.length}/{RANK_COUNT}</span>
            </div>
            <RankZone
              ranked={ranked}
              projectById={projectById}
              completedByProject={completedByProject}
              pmMap={pmMap}
              studioMet={studioMet}
              onOpen={(pid) => setModalProject(pid)}
              onRemove={removeProject}
              ghost={rankingGhost}
              ghostIndex={overIndex ?? ranked.length}
            />
          </div>
        </div>

        {/* The picked-up card tracks the pointer 1:1 (no easing); the list
            reflows underneath. */}
        <DragOverlay dropAnimation={null}>
          {activeProject ? <DragPreview project={activeProject} /> : null}
        </DragOverlay>
      </DndContext>

      <div className="flex flex-col gap-2 border-t pt-6">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!canSubmit && (
          <p className="text-xs text-muted-foreground">
            {ranked.length !== RANK_COUNT
              ? `Rank exactly ${RANK_COUNT} projects (${ranked.length} selected).`
              : studioBlocked.length > 0
                ? "Complete the required coffee chat(s) for your OP Studio picks."
                : "Open each ranked project and complete its questions."}
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Submitting…" : "Submit application"}
          </Button>
        </div>
      </div>

      {modalProject && rankingIdByProject[modalProject] && (
        <ProjectApplicationModal
          projectId={modalProject}
          projectName={projectById(modalProject)?.name ?? "Project"}
          rankingId={rankingIdByProject[modalProject]}
          open={!!modalProject}
          onOpenChange={(o) => { if (!o) setModalProject(null); }}
          onSaved={(completed) => setCompletedByProject((p) => ({ ...p, [modalProject]: completed }))}
        />
      )}
    </div>
  );
}

function AvailableZone({
  studioAvailable,
  launchAvailable,
  studioEligible,
  pmMap,
  studioMet,
  full,
  onAdd,
  ghost,
}: {
  studioAvailable: Project[];
  launchAvailable: Project[];
  studioEligible: boolean;
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
  full: boolean;
  onAdd: (id: string) => void;
  ghost: Project | null;
}) {
  // A drop target so a ranked project can be dragged back here to unrank it.
  const { setNodeRef } = useDroppable({ id: "available-zone" });
  return (
    <div ref={setNodeRef} className="flex flex-col gap-4 rounded-xl">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Projects</h2>
      {studioEligible ? (
        <AvailableGroup title={TYPE_LABELS.studio} list={studioAvailable} pmMap={pmMap} studioMet={studioMet} full={full} onAdd={onAdd} ghost={ghost?.type === "studio" ? ghost : null} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-muted-foreground">{TYPE_LABELS.studio}</h3>
          <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            OP Studio is open to returning members only. First-time applicants can apply to OP Launch projects.
          </p>
        </div>
      )}
      <AvailableGroup title={TYPE_LABELS.launch} list={launchAvailable} pmMap={pmMap} studioMet={studioMet} full={full} onAdd={onAdd} ghost={ghost?.type === "launch" ? ghost : null} />
    </div>
  );
}

function AvailableGroup({
  title,
  list,
  pmMap,
  studioMet,
  full,
  onAdd,
  ghost,
}: {
  title: string;
  list: Project[];
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
  full: boolean;
  onAdd: (id: string) => void;
  ghost: Project | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wide">{title}</h3>
        <span className="text-[10px] font-normal text-muted-foreground/60">({list.length})</span>
      </div>
      {list.length === 0 && !ghost ? (
        <p className="text-xs text-muted-foreground">None available.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <AvailableCard key={p.id} project={p} pmMap={pmMap} studioMet={studioMet} full={full} onAdd={onAdd} />
          ))}
          {ghost && <GhostCard project={ghost} />}
        </div>
      )}
    </div>
  );
}

function AvailableCard({
  project,
  pmMap,
  studioMet,
  full,
  onAdd,
}: {
  project: Project;
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
  full: boolean;
  onAdd: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `avail:${project.id}` });
  // Click toggles this detail dropdown; the + button and drag handle adding.
  const [open, setOpen] = useState(false);
  // The DragOverlay renders the moving copy; the source just dims in place.
  const style = { opacity: isDragging ? 0.4 : 1 } as React.CSSProperties;
  const meta = metaLine(project);
  const met = project.type === "studio" ? studioMet(project.id) : true;
  const pms = pmMap[project.id] ?? [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => setOpen((o) => !o)}
      className="group relative overflow-hidden border rounded-xl p-3 pl-4 bg-background touch-none select-none cursor-grab hover:bg-accent transition-colors"
    >
      {/* Accent color as a slim tab on the card's left edge. */}
      <div
        className="absolute inset-y-0 left-0 w-1.5 pointer-events-none"
        style={{ backgroundColor: project.color || DEFAULT_ACCENT }}
        aria-hidden
      />

      <div className="relative z-10 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <ChevronDown
            size={14}
            className={`text-muted-foreground/50 flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          {project.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.icon_url} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
          ) : project.icon ? (
            <span
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-lg bg-foreground/5"
              style={{ backgroundColor: project.color || undefined, color: project.color ? readableTextColor(project.color) : undefined }}
            >
              {project.icon}
            </span>
          ) : null}
          <span className="font-medium text-sm flex-1 min-w-0 truncate">{project.name}</span>
          {project.client && <span className="text-xs text-muted-foreground">{project.client}</span>}
          <button
            type="button"
            disabled={full}
            onClick={(e) => { e.stopPropagation(); if (!full) onAdd(project.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Add ${project.name}`}
            title={full ? `You can rank up to ${RANK_COUNT} projects` : `Add ${project.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-md border bg-background text-foreground hover:bg-foreground hover:text-background hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background disabled:hover:text-foreground flex-shrink-0 transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>
        {open && (
          <>
            {project.description && <p className="text-sm text-muted-foreground pl-6">{project.description}</p>}
            {meta && <p className="text-[11px] text-muted-foreground/80 pl-6">{meta}</p>}
            {pms.length > 0 && (
              <p className="text-xs text-muted-foreground/80 pl-6">
                PM{pms.length > 1 ? "s" : ""}: {pms.map((pm) => pm.name).join(", ")}
              </p>
            )}
          </>
        )}
        {project.type === "studio" && (
          <div className={`flex items-center gap-1.5 text-[11px] pl-6 ${met ? "text-green-700 dark:text-green-400" : "text-amber-600 dark:text-amber-500"}`}>
            {met ? <Check size={12} /> : <Coffee size={12} />}
            {met ? "Coffee chat complete" : "Coffee chat needed"}
          </div>
        )}
      </div>
    </div>
  );
}

function RankZone({
  ranked,
  projectById,
  completedByProject,
  pmMap,
  studioMet,
  onOpen,
  onRemove,
  ghost,
  ghostIndex,
}: {
  ranked: string[];
  projectById: (id: string) => Project | undefined;
  completedByProject: Record<string, boolean>;
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  ghost: Project | null;
  ghostIndex: number;
}) {
  const { setNodeRef } = useDroppable({ id: "ranked-zone" });
  return (
    <div ref={setNodeRef} className="min-h-40 flex flex-col gap-2">
      {ranked.length === 0 && !ghost ? (
        <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground py-10 rounded-xl bg-accent/20">
          Drag projects here to rank them.
        </div>
      ) : (
        <>
          <SortableContext items={ranked} strategy={verticalListSortingStrategy}>
            {ranked.map((id, i) => {
              const p = projectById(id);
              if (!p) return null;
              return (
                <Fragment key={id}>
                  {ghost && ghostIndex === i && <GhostCard project={ghost} rankNumber={i + 1} />}
                  <RankedCard
                    project={p}
                    rankNumber={i + 1}
                    completed={!!completedByProject[id]}
                    studioNeedsChat={p.type === "studio" && !studioMet(id)}
                    pms={pmMap[id] ?? []}
                    onOpen={() => onOpen(id)}
                    onRemove={() => onRemove(id)}
                  />
                </Fragment>
              );
            })}
          </SortableContext>
          {ghost && ghostIndex >= ranked.length && <GhostCard project={ghost} rankNumber={ranked.length + 1} />}
        </>
      )}
    </div>
  );
}

function RankedCard({
  project,
  rankNumber,
  completed,
  studioNeedsChat,
  pms,
  onOpen,
  onRemove,
}: {
  project: Project;
  rankNumber: number;
  completed: boolean;
  studioNeedsChat: boolean;
  pms: Pm[];
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
  // Siblings reflow with the sortable transition; the dragged item is hidden in
  // place (the DragOverlay shows the moving copy) so it tracks the pointer 1:1.
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-xl border p-3 flex flex-col gap-2 transition-colors touch-none select-none cursor-grab active:cursor-grabbing ${
        completed ? "border-green-600/40 bg-green-600/5" : "bg-background"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground/50 flex-shrink-0" aria-hidden>
          <GripVertical size={15} />
        </span>
        <span
          className={`h-6 w-6 rounded-full text-xs font-semibold flex items-center justify-center flex-shrink-0 ${
            completed ? "bg-green-600 text-white" : "bg-foreground text-background"
          }`}
        >
          {completed ? <Check size={14} /> : rankNumber}
        </span>
        <button onClick={onOpen} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="font-medium text-sm truncate">{project.name}</span>
          {!completed && (
            <span className="text-red-500 font-semibold flex-shrink-0" title="Required questions unfinished" aria-label="Required questions unfinished">
              *
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[11px] font-medium flex-shrink-0">
            {TYPE_LABELS[project.type]}
          </span>
        </button>
        <button
          onClick={onOpen}
          className={`flex-shrink-0 transition-colors ${
            completed
              ? "text-muted-foreground hover:text-foreground"
              : "flex h-7 w-7 items-center justify-center rounded-md bg-white text-neutral-800 border border-black/10 shadow-sm hover:bg-white/90"
          }`}
          aria-label="Edit answers"
        >
          <Pencil size={14} />
        </button>
        <button onClick={onRemove} className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0" aria-label="Remove">
          <X size={15} />
        </button>
      </div>

      {studioNeedsChat && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-500/10 rounded-md px-3 py-2">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span className="flex-1">
            Coffee chat with a PM{pms.length ? ` (${pms.map((pm) => pm.name).join(", ")})` : ""} required.
          </span>
          <Link href="/coffee-chat" className="inline-flex items-center gap-1 font-medium hover:underline flex-shrink-0">
            <Coffee size={13} /> Book
          </Link>
        </div>
      )}

    </div>
  );
}

// A faded placeholder showing where the dragged card will slot in.
function GhostCard({ project, rankNumber }: { project: Project; rankNumber?: number }) {
  return (
    <div className="rounded-xl border border-dashed border-foreground/30 bg-accent/40 p-3 flex items-center gap-2 opacity-70">
      {rankNumber != null ? (
        <span className="h-6 w-6 rounded-full bg-foreground/30 text-background text-xs font-semibold flex items-center justify-center flex-shrink-0">
          {rankNumber}
        </span>
      ) : (
        <GripVertical size={15} className="text-muted-foreground/50 flex-shrink-0" />
      )}
      <span className="font-medium text-sm truncate">{project.name}</span>
      <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[11px] font-medium flex-shrink-0">
        {TYPE_LABELS[project.type]}
      </span>
    </div>
  );
}

// The card rendered under the pointer while dragging (via DragOverlay).
function DragPreview({ project }: { project: Project }) {
  return (
    <div className="rounded-xl border bg-background p-3 shadow-lg flex items-center gap-2 cursor-grabbing">
      <GripVertical size={15} className="text-muted-foreground/50 flex-shrink-0" />
      <span className="font-medium text-sm truncate">{project.name}</span>
      <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[11px] font-medium flex-shrink-0">
        {TYPE_LABELS[project.type]}
      </span>
    </div>
  );
}
