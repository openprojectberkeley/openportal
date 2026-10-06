"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { groupByFamily, type FamilyStanding, type ProjectScore } from "@/lib/scoring";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

/**
 * The member-facing scoreboard: family standings plus the per-project
 * breakdown, for one semester.
 *
 * Both RPCs resolve `null` to the active semester server-side (0103), so
 * passing null is the normal case and not a loading state — the hook is
 * `standings === null` until the first load lands.
 *
 * Totals are computed in SQL, not here: a family's points are the live sum over
 * its projects' non-voided entries, so there is no client-side arithmetic that
 * could drift from what the admin ledger shows.
 */
export function useScoreboard(semesterId: string | null, reloadToken = 0) {
  const [standings, setStandings] = useState<FamilyStanding[] | null>(null);
  const [byFamily, setByFamily] = useState<Map<string | null, ProjectScore[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // The semester switcher can change mid-flight, so only the newest load writes.
  const genRef = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++genRef.current;
    const supabase = createClient();

    const [{ data: standingRows, error: standingError }, { data: projectRows, error: projectError }] =
      await Promise.all([
        supabase.rpc("family_standings", { p_semester_id: semesterId }),
        supabase.rpc("project_scores", { p_semester_id: semesterId }),
      ]);

    if (gen !== genRef.current) return;
    if (standingError || projectError) {
      setError("Couldn't load the scoreboard.");
      setStandings([]);
      setByFamily(new Map());
      return;
    }
    setError(null);
    setStandings((standingRows ?? []) as FamilyStanding[]);
    setByFamily(groupByFamily((projectRows ?? []) as ProjectScore[]));
  }, [semesterId]);

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  // The dashboard card renders inside a long-lived client tree, so a tab switch
  // or a bfcache restore would otherwise leave it showing stale standings.
  useRefreshOnReturn(reload);

  const leader = standings?.[0]?.points ?? 0;
  const totalPoints = standings?.reduce((sum, s) => sum + s.points, 0) ?? 0;
  const totalAwards = standings?.reduce((sum, s) => sum + s.award_count, 0) ?? 0;

  return { standings, byFamily, leader, totalPoints, totalAwards, error, reload };
}
