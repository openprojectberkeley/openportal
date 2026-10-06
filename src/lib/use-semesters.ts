"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Semester } from "@/lib/scoring";

export const SEMESTER_SELECT = "id, name, starts_on, ends_on, is_active";

/**
 * Every scoring semester, newest first, plus whichever one is active.
 *
 * At most one semester can be active — enforced by a partial unique index
 * (0103), not by this hook — so `active` is either that row or null on a fresh
 * database, which the scoreboard renders an empty state for.
 */
export function useSemesters() {
  const [semesters, setSemesters] = useState<Semester[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data, error: selectError } = await supabase
      .from("semesters")
      .select(SEMESTER_SELECT)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (selectError) {
      setError("Couldn't load semesters.");
      setSemesters([]);
      return;
    }
    setError(null);
    setSemesters((data ?? []) as Semester[]);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    semesters,
    active: semesters?.find((s) => s.is_active) ?? null,
    error,
    reload,
  };
}
