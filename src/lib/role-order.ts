// Canonical ordering for a member's roles: President, then VP Projects, then
// the other VPs, then any other exec, then PMs/board. Used both to rank members
// in a list and to order the role chips shown for a single member, so the two
// always agree.
//
// access_level isn't available everywhere roles are rendered (some reads only
// select role_name), so the rank falls back to the role name: unknown roles
// land in the "other exec" tier, with PM explicitly treated as board.
export function roleRank(role: { role_name: string; access_level?: string | null }): number {
  if (role.role_name === "President") return 0;
  if (role.role_name === "VP Projects") return 1;
  if (role.role_name.startsWith("VP")) return 2;
  if (role.access_level === "board" || role.role_name === "PM") return 4;
  return 3;
}

// Sort a member's roles into canonical order (President → VPs → exec → PMs),
// role name breaking ties. Returns a new array; the input is left untouched.
export function sortRoles<T extends { role_name: string; access_level?: string | null }>(roles: T[]): T[] {
  return roles
    .slice()
    .sort((a, b) => roleRank(a) - roleRank(b) || a.role_name.localeCompare(b.role_name));
}
