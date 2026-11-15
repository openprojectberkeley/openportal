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

// Suggestions for "Other relevant classes" (a creatable tag input on the
// application). Upper-division and adjacent courses past the checkbox set
// above; anything else can be typed.
export const OTHER_CLASS_SUGGESTIONS = [
  "CS 160", "CS 161", "CS 162", "CS 164", "CS 168", "CS 169A", "CS 170", "CS 186",
  "CS 188", "CS 189", "Data 101", "Data 102", "Data 140", "EECS 16A", "EECS 16B",
  "EECS 151", "Info 159", "Math 54", "Stat 134", "UGBA 10",
] as const;

export const techAreaLabel = (key: string): string =>
  TECH_AREAS.find((a) => a.key === key)?.label ?? key;

export const techClassLabel = (key: string): string =>
  TECH_CLASSES.find((c) => c.key === key)?.label ?? key;
