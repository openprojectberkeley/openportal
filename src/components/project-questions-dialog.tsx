"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { InfoHint } from "@/components/ui/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { optimistic } from "@/lib/optimistic";
import {
  type ProjectQuestion,
  type QuestionType,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  isChoiceType,
} from "@/lib/application";

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Draft = {
  id: string | null;
  type: QuestionType;
  prompt: string;
  options: string[];
  required: boolean;
};

const emptyDraft = (): Draft => ({ id: null, type: "short_answer", prompt: "", options: [""], required: true });

// Google-Forms-style builder for a project's custom application questions.
// Writable by exec or the project's PMs (RLS enforces; see migration 0020).
const DEFAULT_ESSAY_PROMPT = "Why do you want to work on this project?";

export function ProjectQuestionsDialog({ projectId, open, onOpenChange }: Props) {
  const [questions, setQuestions] = useState<ProjectQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Only creating a question waits (it needs the new row's id); edits,
  // reorders and deletes are optimistic.
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  // The fixed essay question's per-project settings (prompt wording + whether
  // it's required); everything else about it (position, 150-200 word
  // suggestion) stays fixed. Saved on blur/toggle, not via the draft form below.
  const [essayPrompt, setEssayPrompt] = useState(DEFAULT_ESSAY_PROMPT);
  const [essayRequired, setEssayRequired] = useState(true);
  const [essayError, setEssayError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setDraft(null);
    setError(null);
    setEssayError(null);
    const supabase = createClient();
    Promise.all([
      supabase
        .from("project_questions")
        .select("id, project_id, position, type, prompt, options, required")
        .eq("project_id", projectId)
        .order("position"),
      supabase.from("projects").select("essay_prompt, essay_required").eq("id", projectId).maybeSingle(),
    ]).then(([{ data }, { data: project }]) => {
      setQuestions((data ?? []) as ProjectQuestion[]);
      setEssayPrompt(project?.essay_prompt ?? DEFAULT_ESSAY_PROMPT);
      setEssayRequired(project?.essay_required ?? true);
      setLoading(false);
    });
  }, [open, projectId]);

  const saveEssayPrompt = async () => {
    const prompt = essayPrompt.trim();
    if (!prompt) {
      setEssayError("Essay prompt is required.");
      setEssayPrompt(DEFAULT_ESSAY_PROMPT);
      return;
    }
    setEssayError(null);
    if (prompt !== essayPrompt) setEssayPrompt(prompt);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("projects")
      .update({ essay_prompt: prompt })
      .eq("id", projectId);
    if (updateError) setEssayError(updateError.message);
  };

  const saveEssayRequired = (required: boolean) => {
    const supabase = createClient();
    void optimistic({
      label: "essay setting",
      key: `essay-required:${projectId}`,
      apply: () => setEssayRequired(required),
      rollback: () => setEssayRequired(!required),
      commit: () => supabase.from("projects").update({ essay_required: required }).eq("id", projectId).select("id"),
      requireRows: true,
    });
  };

  const openAdd = () => { setError(null); setDraft(emptyDraft()); };
  const openEdit = (q: ProjectQuestion) => {
    setError(null);
    setDraft({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: isChoiceType(q.type) ? (q.options?.length ? [...q.options] : [""]) : [""],
      required: q.required,
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const prompt = draft.prompt.trim();
    if (!prompt) { setError("Question text is required."); return; }
    const options = isChoiceType(draft.type)
      ? draft.options.map((o) => o.trim()).filter(Boolean)
      : null;
    if (isChoiceType(draft.type) && (!options || options.length === 0)) {
      setError("Add at least one option.");
      return;
    }

    setError(null);
    const supabase = createClient();

    if (draft.id) {
      const id = draft.id;
      const next = { type: draft.type, prompt, options, required: draft.required };
      const before = questions;
      void optimistic({
        label: "question",
        key: `question:${id}`,
        apply: () => {
          setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...next } : q)));
          setDraft(null);
        },
        rollback: () => setQuestions(before),
        commit: () =>
          supabase
            .from("project_questions")
            .update({ ...next, updated_at: new Date().toISOString() })
            .eq("id", id)
            .select("id"),
        requireRows: true,
      });
      return;
    } else {
      setCreating(true);
      const position = questions.length ? Math.max(...questions.map((q) => q.position)) + 1 : 0;
      const { data, error: insertError } = await supabase
        .from("project_questions")
        .insert({ project_id: projectId, position, type: draft.type, prompt, options, required: draft.required })
        .select("id, project_id, position, type, prompt, options, required")
        .single();
      setCreating(false);
      if (insertError) { setError(insertError.message); return; }
      setQuestions((prev) => [...prev, data as ProjectQuestion]);
    }

    setDraft(null);
  };

  const deleteQuestion = (q: ProjectQuestion) =>
    ask({
      title: "Delete this question?",
      description: "Existing answers to it are removed too.",
      confirmLabel: "Delete question",
      destructive: true,
      run: () => {
        const supabase = createClient();
        const before = questions;
        void optimistic({
          label: "question deletion",
          key: `question:${q.id}`,
          apply: () => setQuestions((prev) => prev.filter((x) => x.id !== q.id)),
          rollback: () => setQuestions(before),
          commit: () => supabase.from("project_questions").delete().eq("id", q.id).select("id"),
          requireRows: true,
        });
      },
    });

  // Reorders at once; both position writes run behind it.
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= questions.length) return;
    const a = questions[index];
    const b = questions[target];
    const before = questions;
    const supabase = createClient();
    void optimistic({
      label: "question order",
      key: `question-order:${projectId}`,
      apply: () =>
        setQuestions((prev) => {
          const next = [...prev];
          next[index] = { ...b, position: a.position };
          next[target] = { ...a, position: b.position };
          return next;
        }),
      rollback: () => setQuestions(before),
      commit: async () => {
        const results = await Promise.all([
          supabase.from("project_questions").update({ position: b.position }).eq("id", a.id),
          supabase.from("project_questions").update({ position: a.position }).eq("id", b.id),
        ]);
        return results.find((r) => r.error) ?? results[0];
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Application questions</DialogTitle>
        </DialogHeader>

        {confirmDialog}
        <div className="flex flex-col gap-5">
          {loading ? (
            // The real card with its controls disabled; only the prompt text,
            // which is per-project, is missing from the box.
            <div className="flex flex-col gap-3 rounded-lg surface p-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Essay</span>
                <InfoHint label="About the essay">
                  Always first in the applicant&apos;s modal. 150–200 words is suggested; any non-empty answer saves.
                </InfoHint>
                <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  Required
                  <Switch disabled aria-label="Essay required" />
                </label>
              </div>
              <Textarea aria-hidden tabIndex={-1} rows={3} disabled className="resize-none" />
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg surface p-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Essay</span>
                <InfoHint label="About the essay">
                  Always first in the applicant&apos;s modal. 150–200 words is suggested; any non-empty answer saves.
                </InfoHint>
                <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  Required
                  <Switch checked={essayRequired} onCheckedChange={saveEssayRequired} aria-label="Essay required" />
                </label>
              </div>
              <Textarea
                id="essay-prompt"
                aria-label="Essay prompt"
                rows={3}
                value={essayPrompt}
                onChange={(e) => setEssayPrompt(e.target.value)}
                onBlur={saveEssayPrompt}
                className="resize-y"
              />
              {essayError && <p className="text-sm text-destructive">{essayError}</p>}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Custom questions
            </span>
            <InfoHint label="About custom questions">
              These appear in the applicant&apos;s modal for this project, after the essay.
            </InfoHint>
          </div>

          {loading ? (
            <div aria-hidden className="-mx-3 flex flex-col gap-0.5">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5">
                  <div className="flex h-5 items-center">
                    <Skeleton className={`h-3.5 rounded-full ${["w-56", "w-44", "w-64"][i]} max-w-full`} />
                  </div>
                  <div className="flex h-4 items-center">
                    <Skeleton className="h-3 w-32 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : questions.length === 0 ? (
            <p className="rounded-lg bg-foreground/[0.03] px-4 py-6 text-center text-sm text-muted-foreground">
              No custom questions yet
            </p>
          ) : (
            <div className="-mx-3 flex flex-col gap-0.5">
              {questions.map((q, i) => (
                <div key={q.id} className="group flex items-start gap-2 rounded-lg px-3 py-2.5 hover:bg-foreground/[0.03]">
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-sm font-medium whitespace-pre-wrap">{q.prompt}</span>
                    <span className="text-xs text-muted-foreground">
                      {QUESTION_TYPE_LABELS[q.type]}
                      {q.required ? " · required" : " · optional"}
                      {isChoiceType(q.type) && q.options?.length ? ` · ${q.options.length} options` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" aria-label="Move up">
                      <ChevronUp size={15} />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === questions.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" aria-label="Move down">
                      <ChevronDown size={15} />
                    </button>
                    <button onClick={() => openEdit(q)} className="text-muted-foreground hover:text-foreground transition-colors ml-1" aria-label="Edit">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => deleteQuestion(q)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Delete">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {draft ? (
            <div className="flex flex-col gap-3 rounded-lg bg-foreground/[0.03] p-4 animate-fade-in-up">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {draft.id ? "Edit question" : "New question"}
              </span>
              <div className="flex flex-col gap-1">
                <Label htmlFor="q-prompt">Question</Label>
                {draft.type === "long_answer" ? (
                  <Textarea
                    id="q-prompt"
                    rows={3}
                    value={draft.prompt}
                    onChange={(e) => setDraft((d) => (d ? { ...d, prompt: e.target.value } : d))}
                    className="resize-y"
                  />
                ) : (
                  <Input id="q-prompt" value={draft.prompt} onChange={(e) => setDraft((d) => (d ? { ...d, prompt: e.target.value } : d))} />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label>Type</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      {QUESTION_TYPE_LABELS[draft.type]}
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                    {QUESTION_TYPES.map((t) => (
                      <DropdownMenuItem
                        key={t}
                        onSelect={() =>
                          setDraft((d) => (d ? { ...d, type: t, options: isChoiceType(t) && d.options.length === 0 ? [""] : d.options } : d))
                        }
                      >
                        {QUESTION_TYPE_LABELS[t]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {isChoiceType(draft.type) && (
                <div className="flex flex-col gap-1.5">
                  <Label>Options</Label>
                  {draft.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <Input
                        value={opt}
                        placeholder={`Option ${oi + 1}`}
                        onChange={(e) =>
                          setDraft((d) => (d ? { ...d, options: d.options.map((o, j) => (j === oi ? e.target.value : o)) } : d))
                        }
                      />
                      <button
                        onClick={() => setDraft((d) => (d ? { ...d, options: d.options.filter((_, j) => j !== oi) } : d))}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                        aria-label="Remove option"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setDraft((d) => (d ? { ...d, options: [...d.options, ""] } : d))}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
                  >
                    <Plus size={13} /> Add option
                  </button>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm w-fit">
                <Switch
                  checked={draft.required}
                  onCheckedChange={(v) => setDraft((d) => (d ? { ...d, required: v } : d))}
                />
                Required
              </label>

              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setDraft(null); setError(null); }}>Cancel</Button>
                <Button size="sm" onClick={saveDraft} disabled={creating}>{draft.id ? "Save" : "Add question"}</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-fit" onClick={openAdd}>
              <Plus size={14} /> Add question
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
