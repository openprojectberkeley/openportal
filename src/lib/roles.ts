// Role / access-level helpers shared by client and server.

// Must match the role_name value in the roles table exactly.
export const VP_TECH_ROLE_NAME = "VP Tech";
export const PRESIDENT_ROLE_NAME = "President";
export const VP_PROJECTS_ROLE_NAME = "VP Projects";

// Role names granted VP Tech's special in-app capabilities (the "view as" role
// simulation toggle; the coffee-chat booking window admin gated server-side by
// is_vp_tech_or_president() in supabase/migrations/0047_president_vp_tech_parity.sql).
// Keep in sync with that migration. Deliberately does NOT include VP
// Projects — that role only widens application-review scope, below.
export const ELEVATED_ROLE_NAMES: string[] = [VP_TECH_ROLE_NAME, PRESIDENT_ROLE_NAME];

export function hasElevatedRole(roles: { role_name: string | null }[]): boolean {
  return roles.some((r) => r.role_name != null && ELEVATED_ROLE_NAMES.includes(r.role_name));
}

// Role names that can review applications for every project, not just ones
// they PM. Mirrors public.can_review_all_projects() in
// supabase/migrations/0057_project_scoped_application_review.sql — keep in
// sync with that migration.
export const FULL_ACCESS_REVIEW_ROLE_NAMES: string[] = [
  VP_TECH_ROLE_NAME,
  PRESIDENT_ROLE_NAME,
  VP_PROJECTS_ROLE_NAME,
];

export function canReviewAllProjects(roles: { role_name: string | null }[]): boolean {
  return roles.some((r) => r.role_name != null && FULL_ACCESS_REVIEW_ROLE_NAMES.includes(r.role_name));
}

// Cookie that carries a VP Tech/President "view as" simulation so server
// components (e.g. the manager route guard) can honor it too.
export const SIM_COOKIE = "op_sim_persona";

// Shape of a members_roles row joined to its role (a to-one relation, so
// `roles` is a single object at runtime).
export type MemberRoleRow = { roles: { role_name: string | null; access_level: string | null } | null };

export type Persona = "member" | "pm" | "exec";
export const PERSONAS: Persona[] = ["member", "pm", "exec"];

export const PERSONA_LABELS: Record<Persona, string> = {
  member: "Member",
  pm: "PM",
  exec: "Exec",
};

// The access levels each simulated persona should behave as. "member" has no
// special access; "pm" maps to the board-level "PM" role; "exec" is exec.
export const PERSONA_ACCESS_LEVELS: Record<Persona, string[]> = {
  member: [],
  pm: ["board"],
  exec: ["exec"],
};

export function isPersona(v: unknown): v is Persona {
  return v === "member" || v === "pm" || v === "exec";
}

export function accessIsBoardOrExec(levels: string[]): boolean {
  return levels.includes("board") || levels.includes("exec");
}

export function accessIsExec(levels: string[]): boolean {
  return levels.includes("exec");
}

// The persona that best represents a real set of access levels (used as the
// default view and as the fallback for non-simulating users).
export function personaFromAccessLevels(levels: string[]): Persona {
  if (accessIsExec(levels)) return "exec";
  if (levels.includes("board")) return "pm";
  return "member";
}
