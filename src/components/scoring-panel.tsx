"use client";

import { useCallback, useState } from "react";
import { CalendarRange, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelListSkeleton } from "@/components/skeletons";
import { FamilyMark } from "@/components/family-mark";
import { AwardPointsDialog } from "@/components/award-points-dialog";
import { PointsLedger } from "@/components/points-ledger";
import { SemestersDialog } from "@/components/semesters-dialog";
import { useFamilies } from "@/lib/use-families";
import { useSemesters } from "@/lib/use-semesters";
import { useScoreboard } from "@/lib/use-scoreboard";
import { useScoreLedger } from "@/lib/use-score-ledger";
import { DEFAULT_ACCENT } from "@/lib/portal-color";
import { barPct, countLabel, rankLabel } from "@/lib/scoring";

/**
 * The exec-side scoring workbench: which semester is live, an award button, the
 * resulting standings, and the audit log.
 *
 * Separate from the Families tab because awarding targets a *project* and
 * happens repeatedly — putting it behind a family expansion would make exec
 * pick a family before picking a project, which is backwards.
 */
export function ScoringPanel() {
  const { families, projects, error: familiesError, reload: reloadFamilies } = useFamilies();
  const { semesters, active, error: semestersError, reload: reloadSemesters } = useSemesters();
  const [semesterToken, setSemesterToken] = useState(0);

  const semesterId = active?.id ?? null;
  const { standings, leader, totalPoints, totalAwards, reload: reloadBoard } = useScoreboard(
    semesterId,
    semesterToken,
  );
  const { entries, reload: reloadLedger, markVoided } = useScoreLedger(semesterId, 50);

  const [awardOpen, setAwardOpen] = useState(false);
  const [semestersOpen, setSemestersOpen] = useState(false);

  // An award changes both the standings and the log; a semester change changes
  // which semester either one is about.
  const afterAward = useCallback(async () => {
    await Promise.all([reloadBoard(), reloadLedger()]);
  }, [reloadBoard, reloadLedger]);

  const afterSemesterChange = useCallback(async () => {
    await reloadSemesters();
    setSemesterToken((t) => t + 1);
  }, [reloadSemesters]);

  if (families === null || semesters === null) return <PanelListSkeleton rows={4} />;

  const unassignedWithPoints = (entries ?? []).filter(
    (e) => e.family_id === null && e.voided_at === null,
  );

  return (
    <div className="flex flex-col gap-6">
      {(familiesError || semestersError) && (
        <p className="text-sm text-red-500">{familiesError ?? semestersError}</p>
      )}

      {/* Semester bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border rounded-lg px-4 py-3">
        <div className="min-w-0">
          {active ? (
            <>
              <p className="text-sm font-semibold">{active.name}</p>
              <p className="text-xs text-muted-foreground">
                {totalPoints} point{totalPoints === 1 ? "" : "s"} across {totalAwards} award
                {totalAwards === 1 ? "" : "s"}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">No active semester</p>
              <p className="text-xs text-muted-foreground">
                Create one and make it active before awarding points.
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSemestersOpen(true)}>
            <CalendarRange size={14} /> Semesters
          </Button>
          <Button size="sm" onClick={() => setAwardOpen(true)} disabled={!active}>
            <PlusCircle size={15} /> Award points
          </Button>
        </div>
      </div>

      {unassignedWithPoints.length > 0 && (
        <div className="border rounded-lg px-4 py-3 border-amber-500/40 bg-amber-500/5">
          <p className="text-sm font-medium">Points that aren&apos;t counting</p>
          <p className="text-xs text-muted-foreground">
            {unassignedWithPoints.length} award
            {unassignedWithPoints.length === 1 ? "" : "s"} went to a project with no family. Assign
            it in the Families tab and the points roll up automatically.
          </p>
        </div>
      )}

      {/* Standings, so the effect of an award is visible without leaving the tab */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Standings
        </h2>
        <div className="border rounded-lg divide-y">
          {(standings ?? []).map((s, i) => (
            <div key={s.family_id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-7 text-right text-xs font-medium tabular-nums text-muted-foreground">
                {rankLabel(standings ?? [], i)}
              </span>
              <FamilyMark
                icon={s.icon}
                iconUrl={s.icon_url}
                color={s.color}
                name={s.family_name}
                size={24}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.family_name}</p>
                <div className="mt-1 h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${barPct(s.points, leader)}%`,
                      backgroundColor: s.color || DEFAULT_ACCENT,
                    }}
                  />
                </div>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {countLabel(s.project_count, "project")}
              </span>
              <span
                className={`w-14 text-right text-base font-bold tabular-nums ${
                  s.points < 0 ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {s.points}
              </span>
            </div>
          ))}
          {(standings ?? []).length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No families yet. Create them in the Families tab.
            </div>
          )}
        </div>
      </div>

      {/* Audit log */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Points log
        </h2>
        <PointsLedger
          entries={entries}
          onVoided={async (id) => {
            markVoided(id);
            await reloadBoard();
          }}
          emptyLabel={active ? `No points awarded in ${active.name} yet.` : "No active semester."}
        />
      </div>

      <AwardPointsDialog
        open={awardOpen}
        onOpenChange={setAwardOpen}
        projects={projects}
        families={families}
        semester={active}
        onAwarded={afterAward}
      />

      <SemestersDialog
        open={semestersOpen}
        onOpenChange={setSemestersOpen}
        semesters={semesters}
        onChanged={async () => {
          await afterSemesterChange();
          await reloadFamilies();
        }}
      />
    </div>
  );
}
