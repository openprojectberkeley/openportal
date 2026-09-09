import type { createClient } from "@/lib/supabase/client";

// Keep PostgREST `.in()` URLs short (UUID lists explode fast; the old infosesh
// `.or(applicant_id.in.(…),member_id.in.(…))` hit ~15KB with ~190 applicants).
export const IN_CHUNK = 80;

export function chunkIds<T>(ids: T[], size = IN_CHUNK): T[][] {
  if (ids.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Run `query` once per id chunk and concatenate `data` arrays. */
export async function selectInChunks<T>(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(chunkIds(ids).map((chunk) => query(chunk)));
  return results.flatMap((r) => r.data ?? []);
}

type BrowserSupabase = ReturnType<typeof createClient>;

/**
 * Infosesh attendance for the given auth user ids.
 * Two chunked `.in()` queries instead of `.or(applicant_id.in.(…),member_id.in.(…))`
 * so each UUID appears once per request and URLs stay short.
 */
export async function fetchInfoseshAttendedIds(
  supabase: BrowserSupabase,
  ids: string[],
): Promise<Set<string>> {
  const attended = new Set<string>();
  if (ids.length === 0) return attended;

  const idSet = new Set(ids);
  const unique = [...idSet];
  const results = await Promise.all(
    chunkIds(unique).flatMap((chunk) => [
      supabase.from("infosesh_attendance").select("applicant_id, member_id").in("applicant_id", chunk),
      supabase.from("infosesh_attendance").select("applicant_id, member_id").in("member_id", chunk),
    ]),
  );

  for (const { data } of results) {
    for (const r of (data ?? []) as { applicant_id: string | null; member_id: string | null }[]) {
      if (r.applicant_id && idSet.has(r.applicant_id)) attended.add(r.applicant_id);
      if (r.member_id && idSet.has(r.member_id)) attended.add(r.member_id);
    }
  }
  return attended;
}
