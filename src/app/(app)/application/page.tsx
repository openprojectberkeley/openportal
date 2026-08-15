"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronUp, ChevronDown, X, Plus, Check, AlertTriangle, Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelListSkeleton } from "@/components/skeletons";
import { type Difficulty, DIFFICULTY_LABELS } from "@/lib/projects";

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
};

type Pm = { user_id: string; name: string };

const TYPE_LABELS: Record<ProjectType, string> = {
  studio: "OP Studio",
  launch: "OP Launch",
};

const RANK_COUNT = 7;
const MIN_WORDS = 150;
const MAX_WORDS = 200;

const wordCount = (s: string) => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};

export default function ApplicationPage() {
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  // project_id -> its PMs
  const [pmMap, setPmMap] = useState<Record<string, Pm[]>>({});
  // PM user_ids the applicant has completed a coffee chat with
  const [chattedWith, setChattedWith] = useState<Set<string>>(new Set());

  // Ranked project ids in order (index 0 = rank 1), max RANK_COUNT.
  const [ranked, setRanked] = useState<string[]>([]);
  // project_id -> essay text
  const [essays, setEssays] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("applicant_id", user.id)
      .limit(1);
    if (existing?.length) { setSubmitted(true); setLoading(false); return; }

    const [{ data: projectRows }, { data: pmRows }, { data: chatRows }] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, type, client, description, difficulty, estimated_members, num_subteams")
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
    ]);

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
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const studioMet = (projectId: string) =>
    (pmMap[projectId] ?? []).some((pm) => chattedWith.has(pm.user_id));

  const addProject = (id: string) => {
    setRanked((prev) => (prev.includes(id) || prev.length >= RANK_COUNT ? prev : [...prev, id]));
  };

  const removeProject = (id: string) => {
    setRanked((prev) => prev.filter((p) => p !== id));
  };

  const move = (index: number, dir: -1 | 1) => {
    setRanked((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const projectById = (id: string) => projects.find((p) => p.id === id);

  // Validation: exactly RANK_COUNT projects, each essay in [MIN,MAX] words, and
  // every Studio project has a completed coffee chat with one of its PMs.
  const essayOk = (id: string) => {
    const n = wordCount(essays[id] ?? "");
    return n >= MIN_WORDS && n <= MAX_WORDS;
  };
  const studioBlocked = ranked.filter((id) => projectById(id)?.type === "studio" && !studioMet(id));
  const canSubmit =
    ranked.length === RANK_COUNT &&
    ranked.every(essayOk) &&
    studioBlocked.length === 0;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("You must be signed in."); setSubmitting(false); return; }

    const { data: app, error: appError } = await supabase
      .from("applications")
      .insert({ applicant_id: user.id })
      .select("id")
      .single();

    if (appError || !app) {
      // Unique violation → an application already exists for this applicant.
      setError(appError?.code === "23505" ? "You've already submitted an application." : (appError?.message ?? "Failed to submit."));
      setSubmitting(false);
      return;
    }

    const rows = ranked.map((projectId, i) => ({
      application_id: app.id,
      project_id: projectId,
      rank: i + 1,
      essay: (essays[projectId] ?? "").trim(),
    }));

    const { error: ranksError } = await supabase.from("application_rankings").insert(rows);
    if (ranksError) {
      // Roll back the parent so a dangling empty application doesn't mark the
      // checklist complete.
      await supabase.from("applications").delete().eq("id", app.id);
      setError(ranksError.message);
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-6">
        <PanelListSkeleton />
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
            Thanks for applying! We&apos;ve received your project rankings and essays.
          </p>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back home</Link>
        </div>
      </div>
    );
  }

  const available = projects.filter((p) => !ranked.includes(p.id));
  const studioAvailable = available.filter((p) => p.type === "studio");
  const launchAvailable = available.filter((p) => p.type === "launch");
  const full = ranked.length >= RANK_COUNT;

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Application</h1>
        <p className="text-sm text-muted-foreground">
          Rank your top {RANK_COUNT} projects and write a {MIN_WORDS}–{MAX_WORDS} word essay for each.
          OP Studio projects require a completed coffee chat with one of the project&apos;s PMs.
        </p>
      </div>

      {/* Ranked list */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your ranking</h2>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">{ranked.length}/{RANK_COUNT}</span>
        </div>

        {ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground border rounded-xl px-4 py-6 text-center">
            Add projects from below to start building your ranking.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {ranked.map((id, i) => {
              const p = projectById(id);
              if (!p) return null;
              const n = wordCount(essays[id] ?? "");
              const ok = n >= MIN_WORDS && n <= MAX_WORDS;
              const studioNeedsChat = p.type === "studio" && !studioMet(id);
              return (
                <div key={id} className="border rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span className="h-6 w-6 rounded-full bg-foreground text-background text-xs font-semibold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.name}</span>
                        <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[11px] font-medium">
                          {TYPE_LABELS[p.type]}
                        </span>
                        {p.client && (
                          <span className="text-xs text-muted-foreground">{p.client}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                        aria-label="Move up"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === ranked.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                        aria-label="Move down"
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        onClick={() => removeProject(id)}
                        className="text-muted-foreground hover:text-red-500 transition-colors ml-1"
                        aria-label="Remove"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  {studioNeedsChat && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-500/10 rounded-md px-3 py-2">
                      <AlertTriangle size={14} className="flex-shrink-0" />
                      <span className="flex-1">
                        Complete a coffee chat with a PM of this project
                        {(pmMap[id] ?? []).length > 0 && ` (${(pmMap[id] ?? []).map((pm) => pm.name).join(", ")})`}
                        {" "}before applying.
                      </span>
                      <Link href="/coffee-chat" className="inline-flex items-center gap-1 font-medium hover:underline flex-shrink-0">
                        <Coffee size={13} /> Book
                      </Link>
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <textarea
                      value={essays[id] ?? ""}
                      onChange={(e) => setEssays((prev) => ({ ...prev, [id]: e.target.value }))}
                      rows={5}
                      placeholder={`Why do you want to work on ${p.name}? (${MIN_WORDS}–${MAX_WORDS} words)`}
                      className="border rounded-md px-3 py-2 text-sm w-full resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className={`text-xs tabular-nums ${ok ? "text-muted-foreground" : "text-amber-600 dark:text-amber-500"}`}>
                      {n} word{n === 1 ? "" : "s"} · {MIN_WORDS}–{MAX_WORDS} required
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Project picker */}
      {!full && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Add projects</h2>
          <PickerGroup
            title={TYPE_LABELS.studio}
            list={studioAvailable}
            pmMap={pmMap}
            studioMet={studioMet}
            onAdd={addProject}
          />
          <PickerGroup
            title={TYPE_LABELS.launch}
            list={launchAvailable}
            pmMap={pmMap}
            studioMet={studioMet}
            onAdd={addProject}
          />
        </section>
      )}

      {/* Submit */}
      <div className="flex flex-col gap-2 border-t pt-6">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!canSubmit && (
          <p className="text-xs text-muted-foreground">
            {ranked.length !== RANK_COUNT
              ? `Rank exactly ${RANK_COUNT} projects (${ranked.length} selected).`
              : studioBlocked.length > 0
                ? "Complete the required coffee chat(s) for your OP Studio picks."
                : `Each essay must be ${MIN_WORDS}–${MAX_WORDS} words.`}
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Submitting…" : "Submit application"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PickerGroup({
  title,
  list,
  pmMap,
  studioMet,
  onAdd,
}: {
  title: string;
  list: Project[];
  pmMap: Record<string, Pm[]>;
  studioMet: (id: string) => boolean;
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {list.map((p) => {
            const meta = [
              p.difficulty ? DIFFICULTY_LABELS[p.difficulty] : null,
              p.estimated_members != null ? `~${p.estimated_members} members` : null,
              p.num_subteams != null ? `${p.num_subteams} subteam${p.num_subteams === 1 ? "" : "s"}` : null,
            ].filter(Boolean) as string[];
            const met = p.type === "studio" ? studioMet(p.id) : true;
            return (
              <div key={p.id} className="border rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.name}</span>
                      {p.client && <span className="text-xs text-muted-foreground">{p.client}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => onAdd(p.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium border rounded-md px-2 py-1 hover:bg-accent transition-colors flex-shrink-0"
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
                {p.description && (
                  <p className="text-xs text-muted-foreground line-clamp-3">{p.description}</p>
                )}
                {meta.length > 0 && (
                  <p className="text-[11px] text-muted-foreground/80">{meta.join(" · ")}</p>
                )}
                {p.type === "studio" && (
                  <div className={`flex items-center gap-1.5 text-[11px] ${met ? "text-green-700 dark:text-green-400" : "text-amber-600 dark:text-amber-500"}`}>
                    {met ? <Check size={12} /> : <Coffee size={12} />}
                    {met
                      ? "Coffee chat complete"
                      : `Coffee chat needed${(pmMap[p.id] ?? []).length > 0 ? `: ${(pmMap[p.id] ?? []).map((pm) => pm.name).join(", ")}` : ""}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
