"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FamilyScoreboard } from "@/components/family-scoreboard";
import { PointsLedger } from "@/components/points-ledger";
import { useSemesters } from "@/lib/use-semesters";
import { useScoreLedger } from "@/lib/use-score-ledger";
import { ScoreboardSkeleton } from "@/components/skeletons";

/**
 * The family scoreboard, open to every signed-in member.
 *
 * No guard of its own: src/proxy.ts bounces unauthenticated requests to the
 * login page, and everything rendered here is readable by any member under RLS
 * (0100) — the standings and the points log are deliberately public to the club,
 * since an audit trail anyone can read is what makes the scoreboard credible.
 * No Suspense boundary either: nothing here reads request-time state, so the
 * client component's own null-to-skeleton state satisfies cacheComponents.
 */
export default function ScoreboardPage() {
  const { semesters, active } = useSemesters();
  // null until the list lands, then the active semester unless the reader picks
  // another. Past semesters stay viewable; the active one is the default.
  const [picked, setPicked] = useState<string | null>(null);

  const semesterId = picked ?? active?.id ?? null;
  const semester = semesters?.find((s) => s.id === semesterId) ?? null;
  const { entries, markVoided } = useScoreLedger(semesterId, 15);

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Family Scoreboard</h1>
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
      </div>

      {semesters === null ? (
        <ScoreboardSkeleton />
      ) : (
        <FamilyScoreboard semesterId={semesterId} semesterName={semester?.name ?? null} />
      )}

      {semesterId && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Recent awards
          </h2>
          {/* readOnly: voiding is exec's job and lives in /admin → Scoring. */}
          <PointsLedger
            entries={entries}
            readOnly
            onVoided={markVoided}
            emptyLabel="No points awarded yet."
          />
        </div>
      )}
    </div>
  );
}
