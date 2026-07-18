import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PERSONA_ACCESS_LEVELS, SIM_COOKIE, VP_TECH_ROLE_NAME, isPersona, type MemberRoleRow } from "./roles";

/**
 * The access levels to enforce for the current user, honoring a VP Tech
 * "view as" simulation cookie. Simulation can only ever REDUCE access — only
 * VP Tech may simulate, and they're already exec — so it never escalates.
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
  const isVpTech = roles.some((r) => r.role_name === VP_TECH_ROLE_NAME);

  if (!isVpTech) return realLevels;

  const persona = (await cookies()).get(SIM_COOKIE)?.value;
  return isPersona(persona) ? PERSONA_ACCESS_LEVELS[persona] : realLevels;
}
