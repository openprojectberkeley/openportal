"use client";

import { useCallback, useState } from "react";
import { CalendarRange, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AwardPointsDialog } from "@/components/award-points-dialog";
import { SemestersDialog } from "@/components/semesters-dialog";
import { useFamilies } from "@/lib/use-families";
import type { Semester } from "@/lib/scoring";

/**
 * Exec's controls on the scoreboard: pick which semester is live, and award
 * points.
 *
 * These used to be a separate /admin tab that re-rendered its own miniature
 * standings table — the same layout as the page it was a copy of. Running them
 * from the real scoreboard means exec sees the actual board react to an award,
 * with no second rendering of it to keep in sync.
 *
 * Split into its own component (rather than living in the page) so the families
 * and projects fetch the award picker needs only happens for exec; a plain
 * member loading the scoreboard never issues it.
 */
export function ScoreboardAdminControls({
  semester,
  semesters,
  onAwarded,
  onSemestersChanged,
}: {
  /** The semester being viewed — awards land here, not necessarily the active one. */
  semester: Semester | null;
  semesters: Semester[];
  onAwarded: () => Promise<void> | void;
  onSemestersChanged: () => Promise<void> | void;
}) {
  const { families, projects, reload: reloadFamilies } = useFamilies();
  const [awardOpen, setAwardOpen] = useState(false);
  const [semestersOpen, setSemestersOpen] = useState(false);

  const handleSemestersChanged = useCallback(async () => {
    await Promise.all([onSemestersChanged(), reloadFamilies()]);
  }, [onSemestersChanged, reloadFamilies]);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setSemestersOpen(true)}>
          <CalendarRange size={14} /> Semesters
        </Button>
        <Button size="sm" onClick={() => setAwardOpen(true)} disabled={!semester}>
          <PlusCircle size={15} /> Award points
        </Button>
      </div>

      <AwardPointsDialog
        open={awardOpen}
        onOpenChange={setAwardOpen}
        projects={projects}
        families={families ?? []}
        semester={semester}
        onAwarded={onAwarded}
      />

      <SemestersDialog
        open={semestersOpen}
        onOpenChange={setSemestersOpen}
        semesters={semesters}
        onChanged={handleSemestersChanged}
      />
    </>
  );
}
