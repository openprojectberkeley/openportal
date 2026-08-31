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
import { Checkbox } from "@/components/ui/checkbox";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const saveEssayRequired = async (required: boolean) => {
    setEssayRequired(required);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("projects")
      .update({ essay_required: required })
      .eq("id", projectId);
    if (updateError) setEssayError(updateError.message);
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

    setSaving(true);
    setError(null);
    const supabase = createClient();

    if (draft.id) {
      const { error: updateError } = await supabase
        .from("project_questions")
        .update({ type: draft.type, prompt, options, required: draft.required, updated_at: new Date().toISOString() })
        .eq("id", draft.id);
      if (updateError) { setError(updateError.message); setSaving(false); return; }
      setQuestions((prev) =>
        prev.map((q) => (q.id === draft.id ? { ...q, type: draft.type, prompt, options, required: draft.required } : q)),
      );
    } else {
      const position = questions.length ? Math.max(...questions.map((q) => q.position)) + 1 : 0;
      const { data, error: insertError } = await supabase
        .from("project_questions")
        .insert({ project_id: projectId, position, type: draft.type, prompt, options, required: draft.required })
        .select("id, project_id, position, type, prompt, options, required")
        .single();
      if (insertError) { setError(insertError.message); setSaving(false); return; }
      setQuestions((prev) => [...prev, data as ProjectQuestion]);
    }

    setSaving(false);
    setDraft(null);
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm("Delete this question? Existing answers to it are removed too.")) return;
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("project_questions").delete().eq("id", id);
    if (deleteError) return;
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= questions.length) return;
    const a = questions[index];
    const b = questions[target];
    const supabase = createClient();
    // Swap positions in the DB, then reflect locally.
    await Promise.all([
      supabase.from("project_questions").update({ position: b.position }).eq("id", a.id),
      supabase.from("project_questions").update({ position: a.position }).eq("id", b.id),
    ]);
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...b, position: a.position };
      next[target] = { ...a, position: b.position };
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Application questions</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-col gap-3 border rounded-lg p-4 bg-accent/10">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Essay question
              </span>
              <div className="flex flex-col gap-1">
                <Label htmlFor="essay-prompt">Prompt</Label>
                <textarea
                  id="essay-prompt"
                  rows={3}
                  value={essayPrompt}
                  onChange={(e) => setEssayPrompt(e.target.value)}
                  onBlur={saveEssayPrompt}
                  className="border rounded-md px-3 py-2 text-sm w-full resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-[11px] text-muted-foreground">
                  Always first in the applicant&apos;s modal. 150–200 words is suggested; any non-empty answer saves.
                </span>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
                <Checkbox
                  checked={essayRequired}
                  onCheckedChange={(v) => saveEssayRequired(v === true)}
                />
                Required
              </label>
              {essayError && <p className="text-sm text-red-500">{essayError}</p>}
            </div>
          )}

          {!loading && (
            <p className="text-xs text-muted-foreground">
              These appear in the applicant&apos;s modal for this project, after the essay above.
            </p>
          )}

          {loading ? null : questions.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-lg px-4 py-6 text-center">
              No custom questions yet.
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              {questions.map((q, i) => (
                <div key={q.id} className={`flex items-start gap-2 px-3 py-2.5 ${i > 0 ? "border-t" : ""}`}>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-sm font-medium">{q.prompt}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {QUESTION_TYPE_LABELS[q.type]}
                      {q.required ? " · required" : " · optional"}
                      {isChoiceType(q.type) && q.options?.length ? ` · ${q.options.length} options` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" aria-label="Move up">
                      <ChevronUp size={15} />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === questions.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" aria-label="Move down">
                      <ChevronDown size={15} />
                    </button>
                    <button onClick={() => openEdit(q)} className="text-muted-foreground hover:text-foreground transition-colors ml-1" aria-label="Edit">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => deleteQuestion(q.id)} className="text-muted-foreground hover:text-red-500 transition-colors" aria-label="Delete">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {draft ? (
            <div className="flex flex-col gap-3 border rounded-lg p-4 bg-accent/20">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {draft.id ? "Edit question" : "New question"}
              </span>
              <div className="flex flex-col gap-1">
                <Label htmlFor="q-prompt">Question</Label>
                {draft.type === "long_answer" ? (
                  <textarea
                    id="q-prompt"
                    rows={3}
                    value={draft.prompt}
                    onChange={(e) => setDraft((d) => (d ? { ...d, prompt: e.target.value } : d))}
                    className="border rounded-md px-3 py-2 text-sm w-full resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <Input id="q-prompt" value={draft.prompt} onChange={(e) => setDraft((d) => (d ? { ...d, prompt: e.target.value } : d))} />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label>Type</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
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
                        className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
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

              <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
                <Checkbox
                  checked={draft.required}
                  onCheckedChange={(v) => setDraft((d) => (d ? { ...d, required: v === true } : d))}
                />
                Required
              </label>

              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setDraft(null); setError(null); }}>Cancel</Button>
                <Button size="sm" onClick={saveDraft} disabled={saving}>{saving ? "Saving..." : "Save question"}</Button>
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
