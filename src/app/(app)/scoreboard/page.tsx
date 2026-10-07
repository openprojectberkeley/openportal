"use client";

import { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FamilyScoreboard } from "@/components/family-scoreboard";
import { PointsLedger } from "@/components/points-ledger";
import { ScoreboardAdminControls } from "@/components/scoreboard-admin-controls";
import { useRoleSim } from "@/components/role-simulation-provider";
import { useSemesters } from "@/lib/use-semesters";
import { useScoreLedger } from "@/lib/use-score-ledger";
import { ScoreboardSkeleton } from "@/components/skeletons";

/**
 * The family scoreboard, open to every signed-in member — and, for exec, the
 * place scoring is actually run from.
 *
 * No guard of its own: src/proxy.ts bounces unauthenticated requests to the
 * login page, and everything rendered here is readable by any member under RLS
 * (0103) — the standings and the points log are deliberately public to the club,
 * since an audit trail anyone can read is what makes the scoreboard credible.
 * The exec-only controls are gated on the simulated role for the UI's sake, but
 * award_score / void_score_entry / set_active_semester are is_exec()-gated in
 * the database, so hiding them is a convenience, not the boundary.
 * No Suspense boundary either: nothing here reads request-time state, so the
 * client component's own null-to-skeleton state satisfies cacheComponents.
 */
export default function ScoreboardPage() {
  const { isExec } = useRoleSim();
  const { semesters, active, reload: reloadSemesters } = useSemesters();
  // null until the list lands, then the active semester unless the reader picks
  // another. Past semesters stay viewable; the active one is the default.
  const [picked, setPicked] = useState<string | null>(null);
  // Bumped after an award or a void so the standings refetch in place.
  const [reloadToken, setReloadToken] = useState(0);

  const semesterId = picked ?? active?.id ?? null;
  const semester = semesters?.find((s) => s.id === semesterId) ?? null;
  // Exec is auditing, not skimming, so they get the deeper slice of the log.
  const { entries, reload: reloadLedger, markVoided } = useScoreLedger(
    semesterId,
    isExec ? 50 : 15,
  );

  const refresh = useCallback(async () => {
    setReloadToken((t) => t + 1);
    await reloadLedger();
  }, [reloadLedger]);

  const onSemestersChanged = useCallback(async () => {
    await reloadSemesters();
    setReloadToken((t) => t + 1);
  }, [reloadSemesters]);

  // Awards against a project with no family count for nobody — worth saying
  // out loud, but only to the person who can fix it.
  const unassignedWithPoints = isExec
    ? (entries ?? []).filter((e) => e.family_id === null && e.voided_at === null)
    : [];

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Family Scoreboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          {semesters !== null && semesters.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                  {semester?.name ?? "Semester"}
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {semesters.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => setPicked(s.id)}>
                    {s.name}
                    {s.is_active && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Active
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isExec && semesters !== null && (
            <ScoreboardAdminControls
              semester={semester}
              semesters={semesters}
              onAwarded={refresh}
              onSemestersChanged={onSemestersChanged}
            />
          )}
        </div>
      </div>

      {unassignedWithPoints.length > 0 && (
        <div className="rounded-lg px-4 py-3 bg-amber-500/10">
          <p className="text-sm font-medium">Points that aren&apos;t counting</p>
          <p className="text-xs text-muted-foreground">
            {unassignedWithPoints.length} award
            {unassignedWithPoints.length === 1 ? "" : "s"} went to a project with no family. Assign
            it in Admin → Families and the points roll up automatically.
          </p>
        </div>
      )}

      {semesters === null ? (
        <ScoreboardSkeleton />
      ) : (
        <FamilyScoreboard
          semesterId={semesterId}
          semesterName={semester?.name ?? null}
          reloadToken={reloadToken}
        />
      )}

      {semesterId && (
        /* Voiding is exec-only; everyone else reads the same log without it. */
        <PointsLedger
          title={isExec ? "Points log" : "Recent awards"}
          entries={entries}
          readOnly={!isExec}
          onVoided={async (id) => {
            markVoided(id);
            setReloadToken((t) => t + 1);
          }}
          emptyLabel={
            semester ? `No points awarded in ${semester.name} yet.` : "No points awarded yet."
          }
        />
      )}
    </div>
  );
}
