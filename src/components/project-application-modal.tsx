"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  type ProjectQuestion,
  type AnswerValue,
  ESSAY_MIN_WORDS,
  ESSAY_MAX_WORDS,
  ESSAY_WARN_WORDS,
  wordCount,
  essayHasText,
  emptyAnswer,
  answerComplete,
  isChoiceType,
} from "@/lib/application";
import { optimistic } from "@/lib/optimistic";
import { Combobox } from "@/components/ui/combobox";
import { useConfirm } from "@/components/ui/use-confirm";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  projectId: string;
  projectName: string;
  rankingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Reports whether the saved project counts as "done" (essay filled + all
  // required questions answered), so the card can reflect it.
  onSaved: (completed: boolean) => void;
};

// Order-independent, empty-insensitive snapshot of the answers, for detecting
// unsaved changes.
function serializeAnswers(map: Record<string, AnswerValue>): string {
  const out: Record<string, { text: string; options: string[] }> = {};
  for (const [id, v] of Object.entries(map)) {
    const text = v.text ?? "";
    const options = [...(v.options ?? [])].sort();
    if (text.trim() === "" && options.length === 0) continue;
    out[id] = { text: text.trim(), options };
  }
  return JSON.stringify(Object.keys(out).sort().map((k) => [k, out[k]]));
}

// The applicant's per-project application: the project's essay question first
// (prompt/required set per-project, 150-200 words suggested), then its custom
// questions. Persists to the current draft.
export function ProjectApplicationModal({ projectId, projectName, rankingId, open, onOpenChange, onSaved }: Props) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<ProjectQuestion[]>([]);
  const [essayPrompt, setEssayPrompt] = useState("Why do you want to work on this project?");
  const [essayRequired, setEssayRequired] = useState(true);
  const [essay, setEssay] = useState("");
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [error, setError] = useState<string | null>(null);
  // Snapshot of the loaded state, to detect unsaved changes on close.
  const initialEssayRef = useRef("");
  const initialAnswersRef = useRef(serializeAnswers({}));

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const load = async () => {
      const [{ data: qRows }, { data: ranking }, { data: answerRows }, { data: project }] = await Promise.all([
        supabase
          .from("project_questions")
          .select("id, project_id, position, type, prompt, options, required")
          .eq("project_id", projectId)
          .order("position"),
        supabase.from("application_rankings").select("essay").eq("id", rankingId).maybeSingle(),
        supabase.from("application_answers").select("question_id, answer, answer_options").eq("ranking_id", rankingId),
        supabase.from("projects").select("essay_prompt, essay_required").eq("id", projectId).maybeSingle(),
      ]);

      setQuestions((qRows ?? []) as ProjectQuestion[]);
      setEssayPrompt(project?.essay_prompt ?? "Why do you want to work on this project?");
      setEssayRequired(project?.essay_required ?? true);
      setEssay(ranking?.essay ?? "");

      const map: Record<string, AnswerValue> = {};
      for (const row of answerRows ?? []) {
        map[row.question_id as string] = {
          text: (row.answer as string | null) ?? "",
          options: (row.answer_options as string[] | null) ?? [],
        };
      }
      setAnswers(map);
      initialEssayRef.current = ranking?.essay ?? "";
      initialAnswersRef.current = serializeAnswers(map);
      setLoading(false);
    };

    load();
  }, [open, projectId, rankingId]);

  const getAnswer = (id: string) => answers[id] ?? emptyAnswer();
  const setText = (id: string, text: string) =>
    setAnswers((prev) => ({ ...prev, [id]: { ...getAnswer(id), text } }));
  const setSingle = (id: string, option: string) =>
    setAnswers((prev) => ({ ...prev, [id]: { ...getAnswer(id), options: [option] } }));
  const toggleMulti = (id: string, option: string) =>
    setAnswers((prev) => {
      const cur = prev[id]?.options ?? [];
      const next = cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option];
      return { ...prev, [id]: { ...getAnswer(id), options: next } };
    });

  // A project counts as "done" only when the essay has text and every required
  // question is answered. Saving is always allowed — an incomplete save just
  // keeps the project marked not-done.
  const isComplete =
    (!essayRequired || essayHasText(essay)) && questions.every((q) => answerComplete(q, answers[q.id]));

  // Closes and marks the project done/not-done immediately; the essay and
  // answers are written behind it. The values are captured here, so a failed
  // save's Retry (in the toast) re-sends exactly what was typed even though
  // the modal is already closed. A failure shows the project as not done.
  const save = () => {
    setError(null);
    const supabase = createClient();
    const essayValue = essay.trim() || null;
    const complete = isComplete;
    const rows = questions
      .map((q) => {
        const v = getAnswer(q.id);
        if (isChoiceType(q.type)) {
          return v.options.length ? { ranking_id: rankingId, question_id: q.id, answer: null, answer_options: v.options } : null;
        }
        return v.text.trim() ? { ranking_id: rankingId, question_id: q.id, answer: v.text.trim(), answer_options: null } : null;
      })
      .filter(Boolean) as { ranking_id: string; question_id: string; answer: string | null; answer_options: string[] | null }[];

    void optimistic({
      label: `${projectName} application`,
      key: `project-application:${rankingId}`,
      apply: () => {
        onSaved(complete);
        onOpenChange(false);
      },
      rollback: () => onSaved(false),
      commit: async () => {
        const { error: rankingError } = await supabase
          .from("application_rankings")
          .update({ essay: essayValue, completed: complete, updated_at: new Date().toISOString() })
          .eq("id", rankingId);
        if (rankingError) return { error: rankingError };
        // Replace this project's answers wholesale so cleared fields are removed.
        const { error: clearError } = await supabase.from("application_answers").delete().eq("ranking_id", rankingId);
        if (clearError) return { error: clearError };
        if (rows.length) return supabase.from("application_answers").insert(rows);
        return { error: null };
      },
    });
  };

  const essayWords = wordCount(essay);
  const essayFilled = essayHasText(essay);
  const essayShort = essayFilled && essayWords < ESSAY_WARN_WORDS;

  const isDirty = () =>
    essay.trim() !== initialEssayRef.current.trim() || serializeAnswers(answers) !== initialAnswersRef.current;

  // Guard every close path (Cancel, the ✕, click-outside, Escape): confirm
  // before discarding unsaved edits. Saving closes via onOpenChange directly.
  const handleOpenChange = (next: boolean) => {
    if (!next && !loading && isDirty()) {
      ask({
        title: "Discard your changes?",
        description: "You have unsaved changes to this application.",
        confirmLabel: "Discard",
        destructive: true,
        run: () => onOpenChange(false),
      });
      return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {confirmDialog}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{projectName}</DialogTitle>
        </DialogHeader>

        {loading ? (
          // The form's own controls, empty and disabled, so the essay box and
          // footer sit exactly where they will; only the per-project prompt,
          // the word count and the custom questions are placeholders.
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <div aria-hidden className="mb-1.5 flex h-3.5 items-center">
                <Skeleton className="h-3.5 w-64 max-w-full rounded-full" />
              </div>
              <Textarea rows={6} disabled aria-hidden tabIndex={-1} className="resize-none" />
              <div aria-hidden className="flex h-4 items-center">
                <Skeleton className="h-3 w-40 rounded-full" />
              </div>
            </div>
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} aria-hidden className="flex flex-col gap-2.5">
                <div className="flex h-3.5 items-center">
                  <Skeleton className={`h-3.5 max-w-full rounded-full ${i === 0 ? "w-48" : "w-56"}`} />
                </div>
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button disabled>Save</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Essay: prompt/required are per-project, editable via ProjectQuestionsDialog */}
            <div className="flex flex-col gap-1">
              <Label htmlFor="app-essay" className="mb-1.5 whitespace-pre-wrap">
                {essayPrompt} {essayRequired && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                id="app-essay"
                rows={6}
                value={essay}
                onChange={(e) => setEssay(e.target.value)}
                placeholder={`${ESSAY_MIN_WORDS}–${ESSAY_MAX_WORDS} words suggested`}
                className="resize-y"
              />
              {/* One counter line; it turns amber while the essay is short. */}
              <span className={`text-xs tabular-nums ${essayShort ? "text-warning" : "text-muted-foreground"}`}>
                {essayWords} / {ESSAY_MIN_WORDS}–{ESSAY_MAX_WORDS} words{essayShort ? " · a bit short, but you can still save" : ""}
              </span>
            </div>

            {/* Custom questions */}
            {questions.map((q) => {
              const v = getAnswer(q.id);
              return (
                <div key={q.id} className="flex flex-col gap-2.5">
                  <Label className="whitespace-pre-wrap">
                    {q.prompt} {q.required && <span className="text-destructive">*</span>}
                  </Label>

                  {q.type === "short_answer" && (
                    <Input value={v.text} onChange={(e) => setText(q.id, e.target.value)} />
                  )}

                  {q.type === "long_answer" && (
                    <Textarea
                      rows={4}
                      value={v.text}
                      onChange={(e) => setText(q.id, e.target.value)}
                      className="resize-y"
                    />
                  )}

                  {q.type === "multiple_choice" && (
                    <div className="flex flex-col gap-1.5">
                      {(q.options ?? []).map((opt) => (
                        <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name={`q-${q.id}`}
                            checked={v.options[0] === opt}
                            onChange={() => setSingle(q.id, opt)}
                            className="h-4 w-4 accent-foreground"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}

                  {q.type === "dropdown" && (
                    // Searchable once a question has more than a handful of
                    // options; a plain list below that.
                    (q.options ?? []).length > 8 ? (
                      <Combobox
                        aria-label={q.prompt}
                        value={v.options[0] ?? null}
                        onChange={(opt) => setSingle(q.id, opt)}
                        options={(q.options ?? []).map((opt) => ({ value: opt, label: opt }))}
                        placeholder="Select…"
                      />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                            {v.options[0] ?? <span className="text-muted-foreground">Select…</span>}
                            <ChevronDown size={14} className="text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                          {(q.options ?? []).map((opt) => (
                            <DropdownMenuItem key={opt} onSelect={() => setSingle(q.id, opt)}>
                              {opt}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )
                  )}

                  {q.type === "checkboxes" && (
                    <div className="flex flex-col gap-1.5">
                      {(q.options ?? []).map((opt) => (
                        <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={v.options.includes(opt)}
                            onCheckedChange={() => toggleMulti(q.id, opt)}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
