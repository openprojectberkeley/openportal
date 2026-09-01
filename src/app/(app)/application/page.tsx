"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Pencil, X, AlertTriangle, Coffee, ChevronDown, Plus, FileText, Upload, Loader2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ApplicationPageSkeleton } from "@/components/skeletons";
import { ProjectApplicationModal } from "@/components/project-application-modal";
import { type Difficulty, DIFFICULTY_LABELS } from "@/lib/projects";
import { readableTextColor } from "@/lib/portal-color";
import { uploadResume, deleteResume, resumeSignedUrl } from "@/lib/resume-upload";
import { TECH_AREAS, TECH_CLASSES, TECH_CLASS_NA } from "@/lib/application-profile";

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

// The two drop zones the DnD arranges items between.
const RANKED_ZONE = "ranked-zone";
const AVAILABLE_ZONE = "available-zone";

// TEMPORARY: submissions are manually locked while we prep the next cycle.
// The application page stays fully browsable — members can still rank projects
// and fill out their answers (drafts save) — but the "Submit application"
// button is disabled. Set to false to restore normal submission.
const SUBMISSIONS_LOCKED = true;

const metaLine = (p: Project) =>
  [
    p.difficulty ? DIFFICULTY_LABELS[p.difficulty] : null,
    p.estimated_members != null ? `~${p.estimated_members} members` : null,
    p.num_subteams != null ? `${p.num_subteams} subteam${p.num_subteams === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export default function ApplicationPage() {
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  // No application period is currently open — the flow is gated shut.
  const [closed, setClosed] = useState(false);
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

  // "About you" section (optional, per application, auto-saved onto the row).
  const [techAreas, setTechAreas] = useState<Record<string, number>>({});
  const [techClasses, setTechClasses] = useState<string[]>([]);
  const [techClassesOther, setTechClassesOther] = useState("");
  const [aboutNote, setAboutNote] = useState("");
  // Optional resume — one per person, stored in the private application-resumes
  // bucket and referenced on the member's own row (members.resume_path).
  const [resume, setResume] = useState<{ path: string; filename: string } | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const [modalProject, setModalProject] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The id currently being dragged, so the DragOverlay can render a 1:1 preview.
  const [activeId, setActiveId] = useState<string | null>(null);
  // A working copy of `ranked` mutated live while a drag is in flight (so the
  // list reflows under the pointer). Committed to the DB once, on drop. The ref
  // mirrors it so onDragEnd reads the final order without waiting on a re-render.
  const [dragRanked, setDragRanked] = useState<string[] | null>(null);
  const dragRankedRef = useRef<string[] | null>(null);
  const setDrag = useCallback((next: string[] | null) => {
    dragRankedRef.current = next;
    setDragRanked(next);
  }, []);

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
      .select("id, status, tech_area_rankings, tech_classes, tech_classes_other, about_note")
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
      supabase.from("members").select("resume_path, resume_filename").eq("user_id", user.id).maybeSingle(),
    ]);

    setResume(
      memberRow?.resume_path
        ? { path: memberRow.resume_path as string, filename: (memberRow.resume_filename as string | null) ?? "Resume" }
        : null,
    );

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

    // Hydrate an existing draft's "About you" answers.
    if (app) {
      setTechAreas((app.tech_area_rankings as Record<string, number> | null) ?? {});
      setTechClasses((app.tech_classes as string[] | null) ?? []);
      setTechClassesOther(app.tech_classes_other ?? "");
      setAboutNote(app.about_note ?? "");
    }

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
      list.map((pid, i) =>
        idMap[pid]
          ? supabase.from("application_rankings").update({ rank: i + 1 }).eq("id", idMap[pid])
          : Promise.resolve(),
      ),
    );
  };

  // Restore a soft-removed row (keeps its essay/answers — see migration 0021) or
  // insert a fresh one, returning the ranking id and its completed flag.
  const upsertRankingRow = async (
    aId: string,
    projectId: string,
    rank: number,
  ): Promise<{ rid: string; completed: boolean } | null> => {
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("application_rankings")
      .select("id, completed")
      .eq("application_id", aId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (existing) {
      const rid = existing.id as string;
      const { error: updateError } = await supabase
        .from("application_rankings")
        .update({ ranked: true, rank, updated_at: new Date().toISOString() })
        .eq("id", rid);
      if (updateError) return null;
      return { rid, completed: !!existing.completed };
    }
    const { data, error: insertError } = await supabase
      .from("application_rankings")
      .insert({ application_id: aId, project_id: projectId, rank, completed: false, ranked: true })
      .select("id")
      .single();
    if (insertError || !data) return null;
    return { rid: data.id as string, completed: false };
  };

  // The `+` button on an available card — append to the ranking.
  const addProject = async (projectId: string) => {
    if (ranked.includes(projectId) || ranked.length >= RANK_COUNT) return;
    const aId = await ensureApp();
    if (!aId) { setError("Couldn't start your application."); return; }
    const newRanked = [...ranked, projectId];
    const row = await upsertRankingRow(aId, projectId, newRanked.length);
    if (!row) return;
    const nextMap = { ...rankingIdByProject, [projectId]: row.rid };
    setRankingIdByProject(nextMap);
    setCompletedByProject((p) => ({ ...p, [projectId]: row.completed }));
    setRanked(newRanked);
    await syncRanks(newRanked, nextMap);
  };

  // The `X` button on a ranked card — soft-remove so re-adding restores answers.
  const removeProject = async (projectId: string) => {
    const rid = rankingIdByProject[projectId];
    const newRanked = ranked.filter((p) => p !== projectId);
    const supabase = createClient();
    if (rid) await supabase.from("application_rankings").update({ ranked: false }).eq("id", rid);
    const nextMap = { ...rankingIdByProject };
    delete nextMap[projectId];
    setRankingIdByProject(nextMap);
    setCompletedByProject((p) => { const n = { ...p }; delete n[projectId]; return n; });
    setRanked(newRanked);
    await syncRanks(newRanked, nextMap);
  };

  // Persist the net result of a drag (add / remove / reorder) in one pass by
  // diffing the dropped order against the committed one.
  const commitRanked = async (next: string[]) => {
    const prev = ranked;
    const added = next.filter((id) => !prev.includes(id));
    const removed = prev.filter((id) => !next.includes(id));

    if (added.length === 0 && removed.length === 0) {
      if (!sameOrder(prev, next)) {
        setRanked(next);
        await syncRanks(next, rankingIdByProject);
      }
      return;
    }

    const supabase = createClient();
    const aId = added.length ? await ensureApp() : appIdRef.current;
    const nextMap: Record<string, string> = { ...rankingIdByProject };
    const nextCompleted: Record<string, boolean> = { ...completedByProject };

    for (const projectId of added) {
      if (!aId) { setError("Couldn't start your application."); continue; }
      const row = await upsertRankingRow(aId, projectId, next.indexOf(projectId) + 1);
      if (!row) continue;
      nextMap[projectId] = row.rid;
      nextCompleted[projectId] = row.completed;
    }
    for (const projectId of removed) {
      const rid = rankingIdByProject[projectId];
      if (rid) await supabase.from("application_rankings").update({ ranked: false }).eq("id", rid);
      delete nextMap[projectId];
      delete nextCompleted[projectId];
    }

    setRankingIdByProject(nextMap);
    setCompletedByProject(nextCompleted);
    setRanked(next);
    await syncRanks(next, nextMap);
  };

  // ---- "About you" persistence -------------------------------------------
  // Discrete controls (a rating tap, a checkbox) save at once; the two free-text
  // fields debounce through scheduleSave.
  const saveAppFields = async (patch: Record<string, unknown>) => {
    const aId = await ensureApp();
    if (!aId) { setError("Couldn't save your changes."); return; }
    const supabase = createClient();
    await supabase.from("applications").update(patch).eq("id", aId);
  };
  // A ref to the latest saveAppFields, so the unmount flush isn't a stale closure.
  const saveAppFieldsRef = useRef(saveAppFields);
  saveAppFieldsRef.current = saveAppFields;

  const pendingPatchRef = useRef<Record<string, unknown>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = (patch: Record<string, unknown>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const patchToSave = pendingPatchRef.current;
      pendingPatchRef.current = {};
      saveTimerRef.current = null;
      saveAppFieldsRef.current(patchToSave);
    }, 600);
  };
  // Flush any pending debounced text save when leaving the page.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const pending = pendingPatchRef.current;
    if (Object.keys(pending).length) saveAppFieldsRef.current(pending);
  }, []);

  const setRating = (key: string, value: number) => {
    const next = { ...techAreas };
    if (next[key] === value) delete next[key]; // tap the current value to clear
    else next[key] = value;
    setTechAreas(next);
    saveAppFields({ tech_area_rankings: next });
  };

  const toggleClass = (key: string) => {
    // N/A is mutually exclusive with every other option.
    const next =
      key === TECH_CLASS_NA
        ? techClasses.includes(TECH_CLASS_NA)
          ? []
          : [TECH_CLASS_NA]
        : techClasses.includes(key)
          ? techClasses.filter((k) => k !== key)
          : [...techClasses.filter((k) => k !== TECH_CLASS_NA), key];
    setTechClasses(next);
    saveAppFields({ tech_classes: next });
  };

  const onOtherChange = (v: string) => { setTechClassesOther(v); scheduleSave({ tech_classes_other: v }); };
  const onAboutChange = (v: string) => { setAboutNote(v); scheduleSave({ about_note: v }); };

  // ---- Resume upload (Supabase Storage, one per person) -------------------
  const onResumeSelected = async (file: File) => {
    const uid = userIdRef.current;
    if (!uid) return;
    setResumeUploading(true);
    setResumeError(null);
    try {
      const supabase = createClient();
      const { path, filename } = await uploadResume(supabase, uid, file);
      await supabase
        .from("members")
        .update({ resume_path: path, resume_filename: filename, resume_uploaded_at: new Date().toISOString() })
        .eq("user_id", uid);
      setResume({ path, filename });
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setResumeUploading(false);
    }
  };

  const onResumeRemove = async () => {
    const uid = userIdRef.current;
    const current = resume;
    setResume(null);
    setResumeError(null);
    if (!uid) return;
    const supabase = createClient();
    await supabase
      .from("members")
      .update({ resume_path: null, resume_filename: null, resume_uploaded_at: null })
      .eq("user_id", uid);
    if (current?.path) { try { await deleteResume(supabase, current.path); } catch { /* best-effort */ } }
  };

  const projectById = (id: string) => projects.find((p) => p.id === id);
  const studioMet = (projectId: string) => (pmMap[projectId] ?? []).some((pm) => chattedWith.has(pm.user_id));
  const studioBlocked = ranked.filter((id) => projectById(id)?.type === "studio" && !studioMet(id));
  const allCompleted = ranked.length > 0 && ranked.every((id) => completedByProject[id]);
  // The ranking is otherwise complete and ready — used to decide which hint to
  // show when submissions are locked.
  const rankingReady = ranked.length === RANK_COUNT && allCompleted && studioBlocked.length === 0;
  const canSubmit = rankingReady && !SUBMISSIONS_LOCKED;

  // ---- Drag orchestration (multi-container sortable) ----------------------
  // Both lists are sortable containers; `dragRanked` is mutated live on hover so
  // a card can be dropped into any slot (first/last included) and reflows under
  // the pointer. `ranked` derives which projects are "available".
  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setDrag([...ranked]);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overId = String(over.id);
    const base = dragRankedRef.current ?? ranked;
    const inRanked = base.includes(activeIdStr);
    const overRanked = overId === RANKED_ZONE || base.includes(overId);

    // Available → ranking: insert at the hovered slot.
    if (!inRanked && overRanked) {
      if (base.length >= RANK_COUNT) return;
      let newIndex: number;
      if (overId === RANKED_ZONE) {
        newIndex = base.length;
      } else {
        const overIndex = base.indexOf(overId);
        const translated = active.rect.current.translated;
        const isBelow = translated && over.rect ? translated.top > over.rect.top + over.rect.height / 2 : false;
        newIndex = overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : base.length;
      }
      const nextArr = [...base];
      nextArr.splice(newIndex, 0, activeIdStr);
      setDrag(nextArr);
      return;
    }

    // Ranking → available: pull it out of the ranking.
    if (inRanked && !overRanked) {
      setDrag(base.filter((id) => id !== activeIdStr));
      return;
    }

    // Reorder within the ranking.
    if (inRanked && overRanked) {
      const from = base.indexOf(activeIdStr);
      const to = overId === RANKED_ZONE ? base.length - 1 : base.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      setDrag(arrayMove(base, from, to));
    }
  };

  const onDragEnd = () => {
    const result = dragRankedRef.current;
    setActiveId(null);
    setDrag(null);
    // Keep the dropped order on screen immediately; commitRanked reconciles the
    // DB (and fills in ranking ids) against the still-current committed `ranked`.
    if (result && !sameOrder(result, ranked)) {
      setRanked(result);
      commitRanked(result);
    }
  };

  const onDragCancel = () => {
    setActiveId(null);
    setDrag(null);
  };

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
          <h1 className="text-2xl font-bold">Application submissions are closed</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;re not accepting written applications right now. Check back again soon.
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

  // While a drag is live, render from the working copy so the list reflows.
  const rankedView = dragRanked ?? ranked;
  const availableProjects = projects.filter((p) => !rankedView.includes(p.id));
  const studioAvailable = availableProjects.filter((p) => p.type === "studio");
  const launchAvailable = availableProjects.filter((p) => p.type === "launch");
  const availableIds = [...studioAvailable, ...launchAvailable].map((p) => p.id);
  const full = rankedView.length >= RANK_COUNT;
  const activeProject = activeId ? projectById(activeId) : null;

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

      {/* About you — optional background, above the project rankings. */}
      <section className="flex flex-col gap-6 border rounded-xl p-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">About you</h2>
          <p className="text-sm text-muted-foreground">
            A few optional questions to help us match you to projects. Answers save automatically.
          </p>
        </div>

        {/* Technical areas of interest */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <Label className="text-sm font-medium">
              Rank the technical areas you&apos;re interested in working on
            </Label>
            <span className="text-xs text-muted-foreground">
              Optional · 1 (least) – 5 (most). Tap a number again to clear it.
            </span>
          </div>
          <div className="flex flex-col divide-y">
            {TECH_AREAS.map((a) => (
              <div key={a.key} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{a.label}</span>
                <RatingScale value={techAreas[a.key] ?? 0} onChange={(v) => setRating(a.key, v)} />
              </div>
            ))}
          </div>
        </div>

        {/* Tech classes taken */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <Label className="text-sm font-medium">
              Which of the following tech classes (or equivalent) have you taken or are enrolled in?
            </Label>
            <span className="text-xs text-muted-foreground">
              Optional · Include lower/upper-div classes relevant to the projects you want. List any others below.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TECH_CLASSES.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={techClasses.includes(c.key)} onCheckedChange={() => toggleClass(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
          <textarea
            value={techClassesOther}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder="Other relevant classes (comma-separated)…"
            rows={2}
            className="border rounded-md px-3 py-2 text-sm w-full resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </section>

      {/* Resume — optional, one per person, stored privately. */}
      <section className="flex flex-col gap-2 border rounded-xl p-5">
        <div className="flex flex-col gap-0.5">
          <Label className="text-sm font-medium">Resume</Label>
          <span className="text-xs text-muted-foreground">
            Highly recommended · PDF or Word (.pdf, .doc, .docx), up to 500 KB.
          </span>
        </div>
        <ResumeField
          resume={resume}
          uploading={resumeUploading}
          error={resumeError}
          onSelect={onResumeSelected}
          onRemove={onResumeRemove}
        />
      </section>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Available projects */}
          <AvailableZone
            studioAvailable={studioAvailable}
            launchAvailable={launchAvailable}
            availableIds={availableIds}
            pmMap={pmMap}
            studioMet={studioMet}
            full={full}
            onAdd={addProject}
          />

          {/* Ranking */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your ranking</h2>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{rankedView.length}/{RANK_COUNT}</span>
            </div>
            <RankZone
              ranked={rankedView}
              projectById={projectById}
              completedByProject={completedByProject}
              pmMap={pmMap}
              studioMet={studioMet}
              onOpen={(pid) => setModalProject(pid)}
              onRemove={removeProject}
            />
          </div>
        </div>

        {/* The picked-up card tracks the pointer 1:1 (no easing); the list
            reflows underneath. */}
        <DragOverlay dropAnimation={null}>
          {activeProject ? <DragPreview project={activeProject} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Free-text — after the project rankings. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <Label className="text-sm font-medium">Anything else you&apos;d like us to know?</Label>
          <span className="text-xs text-muted-foreground">Optional</span>
        </div>
        <textarea
          value={aboutNote}
          onChange={(e) => onAboutChange(e.target.value)}
          placeholder="Share anything else you'd like the team to know…"
          rows={4}
          className="border rounded-md px-3 py-2 text-sm w-full resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="flex flex-col gap-2 border-t pt-6">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {SUBMISSIONS_LOCKED ? (
          <p className="text-xs text-muted-foreground">
            Submissions are temporarily closed. You can still rank projects and
            fill out your answers — your progress saves automatically, so you can
            submit once we reopen.
          </p>
        ) : (
          !canSubmit && (
            <p className="text-xs text-muted-foreground">
              {ranked.length !== RANK_COUNT
                ? `Rank exactly ${RANK_COUNT} projects (${ranked.length} selected).`
                : studioBlocked.length > 0
                  ? "Complete the required coffee chat(s) for your OP Studio picks."
                  : "Open each ranked project and complete its questions."}
            </p>
          )
        )}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {SUBMISSIONS_LOCKED ? "Submissions closed" : submitting ? "Submitting…" : "Submit application"}
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
  availableIds,
  pmMap,
  studioMet,
  full,
  onAdd,
}: {
  studioAvailable: Project[];
  launchAvailable: Project[];
  availableIds: string[];
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
  full: boolean;
  onAdd: (id: string) => void;
}) {
  // A drop target so a ranked project can be dragged back here to unrank it.
  const { setNodeRef } = useDroppable({ id: AVAILABLE_ZONE });
  return (
    <div ref={setNodeRef} className="flex flex-col gap-4 rounded-xl">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Projects</h2>
      <SortableContext items={availableIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          <AvailableGroup title={TYPE_LABELS.studio} list={studioAvailable} pmMap={pmMap} studioMet={studioMet} full={full} onAdd={onAdd} />
          <p className="text-xs text-muted-foreground">
            Returning members are prioritized for OP Studio projects.
          </p>
        </div>
        <AvailableGroup title={TYPE_LABELS.launch} list={launchAvailable} pmMap={pmMap} studioMet={studioMet} full={full} onAdd={onAdd} />
      </SortableContext>
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
}: {
  title: string;
  list: Project[];
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
  full: boolean;
  onAdd: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wide">{title}</h3>
        <span className="text-[10px] font-normal text-muted-foreground/60">({list.length})</span>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">None available.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              variant="available"
              full={full}
              onAdd={onAdd}
              met={p.type === "studio" ? studioMet(p.id) : true}
              pms={pmMap[p.id] ?? []}
            />
          ))}
        </div>
      )}
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
}: {
  ranked: string[];
  projectById: (id: string) => Project | undefined;
  completedByProject: Record<string, boolean>;
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: RANKED_ZONE });
  return (
    <div ref={setNodeRef} className="min-h-40 flex flex-col gap-2">
      {ranked.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground py-10 rounded-xl bg-accent/20">
          Drag projects here to rank them.
        </div>
      ) : (
        <SortableContext items={ranked} strategy={verticalListSortingStrategy}>
          {ranked.map((id, i) => {
            const p = projectById(id);
            if (!p) return null;
            return (
              <ProjectCard
                key={id}
                project={p}
                variant="ranked"
                rankNumber={i + 1}
                completed={!!completedByProject[id]}
                studioNeedsChat={p.type === "studio" && !studioMet(id)}
                pms={pmMap[id] ?? []}
                onOpen={() => onOpen(id)}
                onRemove={() => onRemove(id)}
              />
            );
          })}
        </SortableContext>
      )}
    </div>
  );
}

type CardProps = {
  project: Project;
  variant: "available" | "ranked";
  full?: boolean;
  onAdd?: (id: string) => void;
  met?: boolean;
  pms?: Pm[];
  rankNumber?: number;
  completed?: boolean;
  studioNeedsChat?: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
};

// One sortable card, shared by both lists so they match in size / border /
// structure and drag between each other seamlessly. Ranked cards hang their
// rank number outside the card, to the left.
function ProjectCard(props: CardProps) {
  const { project, variant, rankNumber, completed } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
  // Click toggles the info dropdown; drag (activation distance) moves the card.
  const [open, setOpen] = useState(false);
  // The dragged item hides in place (the DragOverlay shows the moving copy).
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 } as React.CSSProperties;

  const box = (
    <div
      onClick={() => setOpen((o) => !o)}
      className={`group relative overflow-hidden border rounded-xl p-3 transition-colors hover:bg-accent ${
        completed ? "border-green-600/40 bg-green-600/5" : "bg-background"
      }`}
    >
      <CardContent {...props} open={open} />
    </div>
  );

  if (variant === "ranked") {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="flex items-center gap-2.5 touch-none select-none cursor-grab active:cursor-grabbing"
      >
        <span
          className={`h-6 w-6 rounded-full text-xs font-semibold flex items-center justify-center flex-shrink-0 ${
            completed ? "bg-green-600 text-white" : "bg-foreground text-background"
          }`}
        >
          {completed ? <Check size={14} /> : rankNumber}
        </span>
        <div className="flex-1 min-w-0">{box}</div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="touch-none select-none cursor-grab"
    >
      {box}
    </div>
  );
}

function CardContent({
  project,
  variant,
  open,
  full,
  onAdd,
  met,
  pms,
  completed,
  studioNeedsChat,
  onOpen,
  onRemove,
}: CardProps & { open: boolean }) {
  const meta = metaLine(project);
  return (
    <>
      <div className="relative z-10 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <ChevronDown
            size={14}
            className={`text-muted-foreground/50 flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <ProjectIcon project={project} />
          <span className="font-medium text-sm flex-1 min-w-0 truncate">{project.name}</span>

          {variant === "available" ? (
            <>
              <button
                type="button"
                disabled={full}
                onClick={(e) => { e.stopPropagation(); if (!full) onAdd?.(project.id); }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Add ${project.name}`}
                title={full ? `You can rank up to ${RANK_COUNT} projects` : `Add ${project.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-md border bg-background text-foreground hover:bg-foreground hover:text-background hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background disabled:hover:text-foreground flex-shrink-0 transition-colors"
              >
                <Plus size={16} />
              </button>
            </>
          ) : (
            <>
              {!completed && (
                <span
                  className="text-red-500 font-semibold flex-shrink-0"
                  title="Required questions unfinished"
                  aria-label="Required questions unfinished"
                >
                  *
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[11px] font-medium flex-shrink-0">
                {TYPE_LABELS[project.type]}
              </span>
              {/* Edit: the rounded square flashes while questions are unfinished;
                  the pencil glyph itself stays solid. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Edit answers"
                className="relative flex h-7 w-7 items-center justify-center flex-shrink-0"
              >
                <span
                  className={`absolute inset-0 rounded-md border ${
                    completed
                      ? "border-border bg-background"
                      : "border-amber-500/70 bg-amber-500/10 animate-slow-flash"
                  }`}
                  aria-hidden
                />
                <Pencil size={14} className="relative z-10 text-foreground" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Remove"
                className="flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-red-500 hover:text-white hover:border-red-500 flex-shrink-0 transition-colors"
              >
                <X size={16} />
              </button>
            </>
          )}
        </div>

        {project.client && (
          <p className="text-xs text-muted-foreground pl-6">Client: {project.client}</p>
        )}

        {open && (
          <>
            {project.description && <p className="text-sm text-muted-foreground pl-6">{project.description}</p>}
            {meta && <p className="text-[11px] text-muted-foreground/80 pl-6">{meta}</p>}
            {pms && pms.length > 0 && (
              <p className="text-xs text-muted-foreground/80 pl-6">
                PM{pms.length > 1 ? "s" : ""}: {pms.map((pm) => pm.name).join(", ")}
              </p>
            )}
          </>
        )}

        {variant === "available" && project.type === "studio" && (
          <div className={`flex items-center gap-1.5 text-[11px] pl-6 ${met ? "text-green-700 dark:text-green-400" : "text-amber-600 dark:text-amber-500"}`}>
            {met ? <Check size={12} /> : <Coffee size={12} />}
            {met ? "Coffee chat complete" : "Coffee chat needed"}
          </div>
        )}

        {variant === "ranked" && studioNeedsChat && (
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-500/10 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span className="flex-1">
              Coffee chat with a PM{pms && pms.length ? ` (${pms.map((pm) => pm.name).join(", ")})` : ""} required.
            </span>
            <Link
              href="/coffee-chat"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 font-medium hover:underline flex-shrink-0"
            >
              <Coffee size={13} /> Book
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectIcon({ project }: { project: Project }) {
  if (project.icon_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={project.icon_url} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />;
  }
  if (project.icon) {
    return (
      <span
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-lg bg-foreground/5"
        style={{ backgroundColor: project.color || undefined, color: project.color ? readableTextColor(project.color) : undefined }}
      >
        {project.icon}
      </span>
    );
  }
  return null;
}

// A 1–5 segmented rating for a single technical area: buttons fill up to the
// selected value; tap the current value to clear. No slider primitive exists,
// and discrete 1–5 reads better as buttons.
function RatingScale({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`Rate ${n} of 5`}
          aria-pressed={value === n}
          className={`h-7 w-7 rounded-md border text-xs font-medium transition-colors ${
            value > 0 && value >= n
              ? "bg-foreground text-background border-foreground"
              : "bg-background text-muted-foreground hover:bg-accent"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// Plain resume file picker. Uploads the raw File to Supabase Storage (private
// bucket) via the page's onSelect; the stored filename opens through a signed URL.
function ResumeField({
  resume,
  uploading,
  error,
  onSelect,
  onRemove,
}: {
  resume: { path: string; filename: string } | null;
  uploading: boolean;
  error: string | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);

  const view = async () => {
    if (!resume) return;
    setOpening(true);
    const url = await resumeSignedUrl(createClient(), resume.path);
    setOpening(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      {resume ? (
        <div className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm bg-background">
          <FileText size={16} className="text-muted-foreground flex-shrink-0" />
          <button
            type="button"
            onClick={view}
            disabled={opening}
            className="flex-1 min-w-0 truncate text-left hover:underline disabled:opacity-50"
          >
            {opening ? "Opening…" : resume.filename}
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Replace"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={uploading}
            aria-label="Remove resume"
            className="text-muted-foreground hover:text-red-500 disabled:opacity-50 flex-shrink-0"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <><Loader2 size={14} className="mr-1.5 animate-spin" /> Uploading…</>
          ) : (
            <><Upload size={14} className="mr-1.5" /> Upload resume</>
          )}
        </Button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// The card rendered under the pointer while dragging (via DragOverlay) — mirrors
// the collapsed card look so moving between lists feels seamless.
function DragPreview({ project }: { project: Project }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-background p-3 shadow-lg cursor-grabbing flex items-center gap-2">
      <div className="relative z-10 flex items-center gap-2 min-w-0">
        <ProjectIcon project={project} />
        <span className="font-medium text-sm truncate">{project.name}</span>
        <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[11px] font-medium flex-shrink-0">
          {TYPE_LABELS[project.type]}
        </span>
      </div>
    </div>
  );
}
