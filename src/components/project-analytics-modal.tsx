"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { rankLabel } from "@/lib/application-rank";
import { DonutChart, Legend, type Segment } from "@/components/donut-chart";

// One row per (project, rank) from application_project_rankings() (0061).
type Row = {
  project_id: string;
  project_name: string;
  project_type: string;
  rank: number;
  cnt: number;
};

type ProjectRow = {
  id: string;
  name: string;
  type: string;
  byRank: Record<number, number>;
  total: number;
  firsts: number;
};

const PROJECT_TYPE_LABELS: Record<string, string> = { studio: "OP Studio", launch: "OP Launch" };
const STUDIO = "#7c3aed"; // violet
const LAUNCH = "#0284c7"; // sky

function typeColor(type: string): string {
  return type === "studio" ? STUDIO : LAUNCH;
}

// Exec-only global project analytics for one period: a project × rank matrix of
// how many submitted applicants picked each project 1st, 2nd, … plus first-choice
// popularity and demand-vs-capacity visuals. Fetched from the
// application_project_rankings RPC (+ project capacities) on open.
export function ProjectAnalyticsModal({
  open,
  onOpenChange,
  periodId,
  periodName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodId: string | null;
  periodName?: string | null;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [capacity, setCapacity] = useState<Map<string, number | null>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    setCapacity(new Map());
    if (!periodId) {
      setRows([]);
      return;
    }
    const supabase = createClient();
    (async () => {
      const [ranks, caps] = await Promise.all([
        supabase.rpc("application_project_rankings", { p_period_id: periodId }),
        // projects are world-readable to signed-in members (0005); estimated_members
        // backs the demand-vs-capacity view.
        supabase.from("projects").select("id, estimated_members"),
      ]);
      if (ranks.error) {
        setError(ranks.error.message);
        setRows([]);
        return;
      }
      setCapacity(
        new Map(
          ((caps.data ?? []) as { id: string; estimated_members: number | null }[]).map((p) => [
            p.id,
            p.estimated_members,
          ]),
        ),
      );
      setRows((ranks.data as Row[]) ?? []);
    })();
  }, [open, periodId]);

  const { projects, maxRank, maxFirsts, totalFirsts, studioFirsts, launchFirsts } = useMemo(() => {
    const byProject = new Map<string, ProjectRow>();
    let max = 0;
    for (const r of rows ?? []) {
      max = Math.max(max, r.rank);
      let p = byProject.get(r.project_id);
      if (!p) {
        p = { id: r.project_id, name: r.project_name, type: r.project_type, byRank: {}, total: 0, firsts: 0 };
        byProject.set(r.project_id, p);
      }
      p.byRank[r.rank] = (p.byRank[r.rank] ?? 0) + r.cnt;
      p.total += r.cnt;
      if (r.rank === 1) p.firsts += r.cnt;
    }
    const list = [...byProject.values()].sort((a, b) => b.firsts - a.firsts || a.name.localeCompare(b.name));
    return {
      projects: list,
      maxRank: max,
      maxFirsts: list.reduce((m, p) => Math.max(m, p.firsts), 0),
      totalFirsts: list.reduce((s, p) => s + p.firsts, 0),
      studioFirsts: list.filter((p) => p.type === "studio").reduce((s, p) => s + p.firsts, 0),
      launchFirsts: list.filter((p) => p.type === "launch").reduce((s, p) => s + p.firsts, 0),
    };
  }, [rows]);

  const ranks = Array.from({ length: maxRank }, (_, i) => i + 1);
  const trackSegments: Segment[] = [
    { label: "OP Studio", value: studioFirsts, color: STUDIO },
    { label: "OP Launch", value: launchFirsts, color: LAUNCH },
  ];

  // Demand (1st-choice count) vs capacity, for projects that have a capacity set.
  const withCapacity = projects
    .map((p) => ({ ...p, capacity: capacity.get(p.id) ?? null }))
    .filter((p): p is (typeof projects)[number] & { capacity: number } => typeof p.capacity === "number" && p.capacity > 0)
    .sort((a, b) => b.firsts / b.capacity - a.firsts / a.capacity);
  const noCapacityCount = projects.length - withCapacity.length;
  const maxDemandCap = withCapacity.reduce((m, p) => Math.max(m, p.firsts, p.capacity), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project analytics{periodName ? ` · ${periodName}` : ""}</DialogTitle>
        </DialogHeader>

        {rows === null ? (
          <div className="h-64 rounded-xl border bg-muted animate-pulse" />
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-xs text-muted-foreground">
              {projects.length} projects · how many submitted applicants ranked each 1st, 2nd, … Sorted by 1st-choice count.
            </p>
            {error && <p className="text-sm text-red-500">{error}</p>}

            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ranked applications for this period yet.</p>
            ) : (
              <>
                {/* First-choice popularity + track split */}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                  <div className="flex flex-col gap-2 rounded-xl border bg-background p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      First-choice popularity
                    </h3>
                    <ul className="flex flex-col gap-1.5">
                      {projects.map((p) => {
                        const width = maxFirsts === 0 ? 0 : Math.round((p.firsts / maxFirsts) * 100);
                        return (
                          <li key={p.id} className="flex items-center gap-2 text-xs">
                            <span className="w-28 flex-shrink-0 truncate text-foreground/90" title={p.name}>
                              {p.name}
                            </span>
                            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${width}%`, background: typeColor(p.type) }}
                              />
                            </div>
                            <span className="w-6 flex-shrink-0 text-right tabular-nums text-muted-foreground">
                              {p.firsts}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-1 flex items-center gap-4 text-[0.7rem] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STUDIO }} /> OP Studio
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: LAUNCH }} /> OP Launch
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 rounded-xl border bg-background p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      1st choices by track
                    </h3>
                    <div className="flex items-center gap-4">
                      <DonutChart
                        segments={trackSegments}
                        total={totalFirsts}
                        centerValue={`${totalFirsts}`}
                        centerSub="1st picks"
                      />
                      <div className="min-w-0">
                        <Legend segments={trackSegments} total={totalFirsts} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Demand vs capacity */}
                <div className="flex flex-col gap-2 rounded-xl border bg-background p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Demand vs capacity
                  </h3>
                  {withCapacity.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No projects have a capacity set.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {withCapacity.map((p) => {
                        const over = p.firsts > p.capacity;
                        const demandW = maxDemandCap === 0 ? 0 : Math.round((p.firsts / maxDemandCap) * 100);
                        const capW = maxDemandCap === 0 ? 0 : Math.round((p.capacity / maxDemandCap) * 100);
                        return (
                          <li key={p.id} className="flex items-center gap-2 text-xs">
                            <span className="w-28 flex-shrink-0 truncate text-foreground/90" title={p.name}>
                              {p.name}
                            </span>
                            {/* Fill = 1st-choice demand (red when oversubscribed); tick marks capacity on top. */}
                            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                              <div
                                className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-red-500" : "bg-foreground/60")}
                                style={{ width: `${demandW}%` }}
                              />
                              <div
                                className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-background shadow-[0_0_0_1px_hsl(var(--foreground))]"
                                style={{ left: `${capW}%` }}
                                aria-hidden
                              />
                            </div>
                            <span
                              className={cn(
                                "w-24 flex-shrink-0 text-right tabular-nums",
                                over ? "text-red-500 font-medium" : "text-muted-foreground",
                              )}
                            >
                              {p.firsts}/{p.capacity} ({(p.firsts / p.capacity).toFixed(1)}×)
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-[0.7rem] text-muted-foreground">
                    1st-choice demand vs estimated team size; the notch marks capacity, red bars are oversubscribed.
                    {noCapacityCount > 0 && ` ${noCapacityCount} project${noCapacityCount === 1 ? "" : "s"} have no capacity set.`}
                  </p>
                </div>

                {/* Detailed matrix */}
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    By rank
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Project</th>
                          {ranks.map((rank) => (
                            <th
                              key={rank}
                              className={cn(
                                "py-1.5 px-2 text-right font-medium tabular-nums whitespace-nowrap",
                                rank === 1 && "text-foreground",
                              )}
                            >
                              {rankLabel(rank)}
                            </th>
                          ))}
                          <th className="py-1.5 pl-2 text-right font-medium tabular-nums">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map((p) => (
                          <tr key={p.id} className="border-t">
                            <td className="py-1.5 pr-3">
                              <span className="font-medium">{p.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {PROJECT_TYPE_LABELS[p.type] ?? p.type}
                              </span>
                            </td>
                            {ranks.map((rank) => (
                              <td
                                key={rank}
                                className={cn(
                                  "py-1.5 px-2 text-right tabular-nums",
                                  rank === 1 && "bg-foreground/5 font-semibold",
                                  !p.byRank[rank] && "text-muted-foreground/50",
                                )}
                              >
                                {p.byRank[rank] ?? 0}
                              </td>
                            ))}
                            <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{p.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
