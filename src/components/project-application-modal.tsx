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
import { ProjectApplicationModalSkeleton } from "@/components/skeletons";
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

// The applicant's per-project application: the fixed 150-200 word essay first,
// then the project's custom questions. Persists to the current draft.
export function ProjectApplicationModal({ projectId, projectName, rankingId, open, onOpenChange, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<ProjectQuestion[]>([]);
  const [essay, setEssay] = useState("");
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [saving, setSaving] = useState(false);
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
      const [{ data: qRows }, { data: ranking }, { data: answerRows }] = await Promise.all([
        supabase
          .from("project_questions")
          .select("id, project_id, position, type, prompt, options, required")
          .eq("project_id", projectId)
          .order("position"),
        supabase.from("application_rankings").select("essay").eq("id", rankingId).maybeSingle(),
        supabase.from("application_answers").select("question_id, answer, answer_options").eq("ranking_id", rankingId),
      ]);

      setQuestions((qRows ?? []) as ProjectQuestion[]);
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
    essayHasText(essay) && questions.every((q) => answerComplete(q, answers[q.id]));

  const save = async () => {
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const { error: rankingError } = await supabase
      .from("application_rankings")
      .update({ essay: essay.trim() || null, completed: isComplete, updated_at: new Date().toISOString() })
      .eq("id", rankingId);
    if (rankingError) { setError(rankingError.message); setSaving(false); return; }

    // Replace this project's answers wholesale so cleared fields are removed.
    await supabase.from("application_answers").delete().eq("ranking_id", rankingId);
    const rows = questions
      .map((q) => {
        const v = getAnswer(q.id);
        if (isChoiceType(q.type)) {
          return v.options.length ? { ranking_id: rankingId, question_id: q.id, answer: null, answer_options: v.options } : null;
        }
        return v.text.trim() ? { ranking_id: rankingId, question_id: q.id, answer: v.text.trim(), answer_options: null } : null;
      })
      .filter(Boolean) as { ranking_id: string; question_id: string; answer: string | null; answer_options: string[] | null }[];
    if (rows.length) {
      const { error: answersError } = await supabase.from("application_answers").insert(rows);
      if (answersError) { setError(answersError.message); setSaving(false); return; }
    }

    setSaving(false);
    onSaved(isComplete);
    onOpenChange(false);
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
      if (!window.confirm("You have unsaved changes to this application. Discard them?")) return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{projectName}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <ProjectApplicationModalSkeleton />
        ) : (
          <div className="flex flex-col gap-5">
            {/* Fixed essay */}
            <div className="flex flex-col gap-1">
              <Label htmlFor="app-essay" className="mb-1.5">
                Why do you want to work on this project? <span className="text-red-500">*</span>
              </Label>
              <textarea
                id="app-essay"
                rows={6}
                value={essay}
                onChange={(e) => setEssay(e.target.value)}
                placeholder={`${ESSAY_MIN_WORDS}–${ESSAY_MAX_WORDS} words suggested`}
                className="border rounded-md px-3 py-2 text-sm w-full resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs tabular-nums text-muted-foreground">
                {essayWords} word{essayWords === 1 ? "" : "s"} · {ESSAY_MIN_WORDS}–{ESSAY_MAX_WORDS} suggested
              </span>
              {essayShort && (
                <span className="text-xs text-amber-600 dark:text-amber-500">
                  This is a bit short — {ESSAY_MIN_WORDS}–{ESSAY_MAX_WORDS} words is suggested. You can still save it.
                </span>
              )}
            </div>

            {/* Custom questions */}
            {questions.map((q) => {
              const v = getAnswer(q.id);
              return (
                <div key={q.id} className="flex flex-col gap-2.5">
                  <Label>
                    {q.prompt} {q.required && <span className="text-red-500">*</span>}
                  </Label>

                  {q.type === "short_answer" && (
                    <Input value={v.text} onChange={(e) => setText(q.id, e.target.value)} />
                  )}

                  {q.type === "long_answer" && (
                    <textarea
                      rows={4}
                      value={v.text}
                      onChange={(e) => setText(q.id, e.target.value)}
                      className="border rounded-md px-3 py-2 text-sm w-full resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
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

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
