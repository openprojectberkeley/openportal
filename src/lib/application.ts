// Shared types + helpers for the member application flow: per-project custom
// questions, the fixed essay, and answer validation. Used by the applicant
// application page, the per-project modal, and the question-authoring builder.

export type QuestionType =
  | "short_answer"
  | "long_answer"
  | "multiple_choice"
  | "dropdown"
  | "checkboxes";

export const QUESTION_TYPES: QuestionType[] = [
  "short_answer",
  "long_answer",
  "multiple_choice",
  "dropdown",
  "checkboxes",
];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_answer: "Short answer",
  long_answer: "Long answer",
  multiple_choice: "Multiple choice",
  dropdown: "Dropdown",
  checkboxes: "Checkboxes",
};

// Choice types carry a list of options and store the selection(s); text types
// store free text.
export const isChoiceType = (t: QuestionType) =>
  t === "multiple_choice" || t === "dropdown" || t === "checkboxes";

export const isMultiSelect = (t: QuestionType) => t === "checkboxes";

export type ProjectQuestion = {
  id: string;
  project_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  options: string[] | null;
  required: boolean;
};

// The essay is a fixed, required long-answer at the top of every project's
// application modal. 150-200 words is the *suggested* length; any non-empty
// essay can be saved, but under ESSAY_WARN_WORDS we show a gentle warning.
export const ESSAY_MIN_WORDS = 150;
export const ESSAY_MAX_WORDS = 200;
export const ESSAY_WARN_WORDS = 100;

export const wordCount = (s: string) => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};

// An essay is saveable as long as it has some text.
export const essayHasText = (s: string) => s.trim().length > 0;

// A single question's answer, as held in form state.
export type AnswerValue = { text: string; options: string[] };

export const emptyAnswer = (): AnswerValue => ({ text: "", options: [] });

// Whether a question's answer satisfies its `required` flag. Optional questions
// are always "complete".
export const answerComplete = (q: ProjectQuestion, a: AnswerValue | undefined): boolean => {
  if (!q.required) return true;
  const value = a ?? emptyAnswer();
  if (isMultiSelect(q.type)) return value.options.length > 0;
  if (isChoiceType(q.type)) return value.options.length > 0;
  return value.text.trim().length > 0;
};
