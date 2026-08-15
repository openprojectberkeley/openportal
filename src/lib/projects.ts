// Project difficulty levels, shared across the admin panel, project-edit
// dialog, and the application flow so labels/options stay in sync.

export type Difficulty = "beginner" | "intermediate" | "advanced";

export const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};
