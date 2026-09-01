// Shared definitions for the optional applicant-background fields on an
// application (the "About you" section). Keys are stable and persisted on
// `applications.tech_area_rankings` / `applications.tech_classes`; labels are
// display-only. Used by both the applicant form and the reviewer modal.

export type LabeledKey = { key: string; label: string };

export const TECH_AREAS: LabeledKey[] = [
  { key: "machine_learning", label: "Machine Learning" },
  { key: "ai_automation", label: "AI Automation / workflow" },
  { key: "hardware", label: "Hardware & engineering" },
  { key: "frontend", label: "Frontend (UI/UX, Animation)" },
  { key: "mobile", label: "Mobile App Development" },
  { key: "data_cleaning", label: "Data cleaning & acquisition" },
  { key: "design", label: "Design" },
  { key: "backend_algos", label: "Backend algorithms & data structures" },
  { key: "system_design", label: "System design" },
  { key: "data_engineering", label: "Data Engineering & Database" },
  { key: "nlp_llm", label: "Language Models & Chatbot (NLP, LLMs)" },
];

export const TECH_CLASS_NA = "na";
export const TECH_CLASSES: LabeledKey[] = [
  { key: "data_c88c", label: "Data C88C" },
  { key: "cs61a", label: "CS 61A" },
  { key: "cs61b", label: "CS 61B" },
  { key: "cs61c", label: "CS 61C" },
  { key: "data8", label: "Data 8" },
  { key: "data100", label: "Data 100" },
  { key: "cs70_math55", label: "CS 70 / Math 55" },
  { key: TECH_CLASS_NA, label: "N/A (haven't taken any of the above)" },
];

export const techAreaLabel = (key: string): string =>
  TECH_AREAS.find((a) => a.key === key)?.label ?? key;

export const techClassLabel = (key: string): string =>
  TECH_CLASSES.find((c) => c.key === key)?.label ?? key;
