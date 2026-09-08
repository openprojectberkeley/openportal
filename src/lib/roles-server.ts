import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PERSONA_ACCESS_LEVELS, SIM_COOKIE, hasElevatedRole, isPersona, type MemberRoleRow } from "./roles";

/**
 * The real role names to enforce for the current user, honoring a VP Tech /
 * President "view as" simulation cookie. Simulation can only ever REDUCE
 * access, so a simulated non-exec persona sees no role names at all — only
 * VP Tech/President can simulate, and they're already exec, so this never
 * escalates. Used for role-name-specific gates (e.g. canReviewAllProjects)
 * that access_level alone can't express, since VP Projects widens review
 * scope without necessarily being an "exec" access level.
 */
export async function getEffectiveRoleNames(supabase: SupabaseClient): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: roleRows } = await supabase
    .from("members_roles")
    .select("roles(role_name, access_level)")
    .eq("user_id", user.id);

  const roles = ((roleRows ?? []) as unknown as MemberRoleRow[]).flatMap((r) => (r.roles ? [r.roles] : []));
  const realNames = roles.map((r) => r.role_name).filter((n): n is string => n != null);
  const canSimulate = hasElevatedRole(roles);

  if (!canSimulate) return realNames;

  const persona = (await cookies()).get(SIM_COOKIE)?.value;
  return isPersona(persona) && persona !== "exec" ? [] : realNames;
}

/**
 * The access levels to enforce for the current user, honoring a VP Tech /
 * President "view as" simulation cookie. Simulation can only ever REDUCE
 * access — only VP Tech/President may simulate, and they're already exec —
 * so it never escalates.
 */
export async function getEffectiveAccessLevels(supabase: SupabaseClient): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: roleRows } = await supabase
    .from("members_roles")
    .select("roles(role_name, access_level)")
    .eq("user_id", user.id);

  const roles = ((roleRows ?? []) as unknown as MemberRoleRow[]).flatMap((r) => (r.roles ? [r.roles] : []));
  const realLevels = roles.map((r) => r.access_level).filter(Boolean) as string[];
  const canSimulate = hasElevatedRole(roles);

  // board = exec + PMs: a PM of any project has board access even without a
  // board/exec role row.
  const { data: pmRows } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id)
    .eq("is_pm", true)
    .limit(1);
  if ((pmRows ?? []).length > 0 && !realLevels.includes("board")) realLevels.push("board");

  if (!canSimulate) return realLevels;

  const persona = (await cookies()).get(SIM_COOKIE)?.value;
  return isPersona(persona) ? PERSONA_ACCESS_LEVELS[persona] : realLevels;
}
