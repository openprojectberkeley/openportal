"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Family } from "@/lib/scoring";

export const FAMILY_SELECT = "id, name, description, icon, icon_url, color";

// Just enough of a project to list it under a family and paint its row.
export type FamilyProject = {
  id: string;
  name: string;
  family_id: string | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
};

/**
 * The Families admin tab's data: every family plus every project, bucketed by
 * which family it belongs to.
 *
 * Reads go through the browser client rather than an `/api/admin` route (the way
 * projects-panel does) because both tables have open SELECT policies and
 * neither read joins `members` — there's nothing here RLS won't hand a plain
 * member, so there's no reason to proxy it.
 */
export function useFamilies() {
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [projects, setProjects] = useState<FamilyProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Two awaited round trips, so a reload triggered while one is in flight can
  // overtake it. Only the newest load writes. Same guard as use-all-projects-board.
  const genRef = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++genRef.current;
    const supabase = createClient();

    const [{ data: famRows, error: famError }, { data: projRows, error: projError }] =
      await Promise.all([
        supabase.from("families").select(FAMILY_SELECT).order("name"),
        supabase
          .from("projects")
          .select("id, name, family_id, icon, icon_url, color")
          .order("name"),
      ]);

    if (gen !== genRef.current) return;
    if (famError || projError) {
      setError("Couldn't load families.");
      setFamilies([]);
      return;
    }
    setError(null);
    setFamilies((famRows ?? []) as Family[]);
    setProjects((projRows ?? []) as FamilyProject[]);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const projectsByFamily = new Map<string, FamilyProject[]>();
  const unassigned: FamilyProject[] = [];
  for (const p of projects) {
    if (p.family_id === null) unassigned.push(p);
    else {
      const bucket = projectsByFamily.get(p.family_id);
      if (bucket) bucket.push(p);
      else projectsByFamily.set(p.family_id, [p]);
    }
  }

  return { families, projects, projectsByFamily, unassigned, error, reload };
}
