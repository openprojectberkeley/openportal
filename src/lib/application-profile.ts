// Option lists for the optional "About you" section of the application
// (technical-area interest ratings + tech-classes taken). Keys are stable and
// persisted on the applications row (tech_area_rankings jsonb / tech_classes
// jsonb); labels are display-only.

export type Option = { key: string; label: string };

export const TECH_AREAS: Option[] = [
  { key: "machine_learning", label: "Machine Learning" },
  { key: "ai_automation", label: "AI Automation/workflow" },
  { key: "hardware", label: "Hardware & engineering" },
  { key: "frontend", label: "Frontend (UI/UX, Animation)" },
  { key: "mobile", label: "Mobile App Development" },
  { key: "data_cleaning", label: "Data cleaning & acquisition" },
  { key: "design", label: "Design" },
  { key: "backend_algos", label: "Backend algorithms & data structure" },
  { key: "system_design", label: "System design" },
  { key: "data_engineering", label: "Data Engineering & Database" },
  { key: "nlp_llm", label: "Language Models & Chatbot (NLP, LLMs)" },
];

// "N/A" is mutually exclusive with the other options.
export const TECH_CLASS_NA = "na";

export const TECH_CLASSES: Option[] = [
  { key: "data_c88c", label: "Data C88C" },
  { key: "cs61a", label: "CS 61A" },
  { key: "cs61b", label: "CS 61B" },
  { key: "cs61c", label: "CS 61C" },
  { key: "data8", label: "Data 8" },
  { key: "data100", label: "Data 100" },
  { key: "cs70_math55", label: "CS70 / Math 55" },
  { key: TECH_CLASS_NA, label: "N/A (haven't taken any of the above)" },
];

const AREA_LABELS = new Map(TECH_AREAS.map((a) => [a.key, a.label]));
const CLASS_LABELS = new Map(TECH_CLASSES.map((c) => [c.key, c.label]));

export const techAreaLabel = (key: string): string => AREA_LABELS.get(key) ?? key;
export const techClassLabel = (key: string): string => CLASS_LABELS.get(key) ?? key;
