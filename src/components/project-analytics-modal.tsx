"use client";

import { Disclosure } from "@/components/ui/disclosure";
import { Skeleton } from "@/components/ui/skeleton";
import { ColorDot, MetricBar } from "@/components/metric-bar";
import { Section } from "@/components/application-analytics-modal";
import { cn } from "@/lib/utils";
import type { RecruitingAnalytics } from "@/lib/use-recruiting-analytics";

// The Projects tab of the exec analytics modal: 1st-choice demand against each
// project's estimated team size, what the draft offered and landed, the
// studio/launch split, and the full project × rank matrix on demand.

const TYPE_LABELS: Record<string, string> = { studio: "Studio", launch: "Launch" };
const typeLabel = (t: string | null) => (t ? TYPE_LABELS[t] ?? t : "");

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function ProjectsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-4 w-32 rounded-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3.5 w-32 shrink-0 rounded-full sm:w-48" />
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-3 w-10 shrink-0 rounded-full" />
          </div>
          <Skeleton className="h-3 w-56 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ProjectsTab({ data }: { data: RecruitingAnalytics }) {
  const { rows, maxRank, byType } = data.projects;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No rankings or draft rounds for this period yet.</p>;

  const scale = Math.max(...rows.map((r) => Math.max(r.firsts, r.capacity ?? 0)), 1);
  const totalFirsts = byType.reduce((s, t) => s + t.firsts, 0);
  const ranks = Array.from({ length: maxRank }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Demand"
        count={rows.length}
        index={0}
        hint="Bar: 1st-choice applicants. Notch: estimated team size. Sorted by demand per seat; projects without a size set sit last."
      >
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => {
            const over = r.capacity != null && r.firsts > r.capacity;
            return (
              <li key={r.id} className="flex flex-col gap-1">
                <MetricBar
                  index={i}
                  mark={<ColorDot color={r.color} />}
                  label={r.name}
                  meta={typeLabel(r.type)}
                  value={r.firsts}
                  max={scale}
                  notch={r.capacity != null ? r.capacity / scale : null}
                  valueClassName={over ? "text-warning" : undefined}
                  display={r.capacity != null ? `${r.firsts}/${r.capacity}` : r.firsts}
                />
                <p className="pl-4 text-xs text-muted-foreground tabular-nums">
                  {r.rankings} ranked · {r.offered} picks offered · {r.drafted} drafted · {r.accepted} accepted
                </p>
              </li>
            );
          })}
        </ul>
      </Section>

      {byType.length > 1 && (
        <Section title="Studio vs Launch" index={1} hint="Share of all 1st choices, with draft totals per type.">
          <div className="flex flex-col gap-3">
            {byType.map((t, i) => (
              <div key={t.type} className="flex flex-col gap-1">
                <MetricBar
                  index={i}
                  label={typeLabel(t.type) || "Other"}
                  meta={`${t.projects} projects`}
                  value={t.firsts}
                  max={totalFirsts}
                  display={`${totalFirsts ? Math.round((t.firsts / totalFirsts) * 100) : 0}%`}
                />
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t.firsts} 1st choices · {t.offered} picks offered · {t.drafted} drafted · {t.accepted} accepted
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {maxRank > 0 && (
        <Disclosure label="By rank">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Project</th>
                  {ranks.map((n) => (
                    <th key={n} className="px-2 py-1.5 text-right font-medium">
                      {ordinal(n)}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .filter((r) => r.rankings > 0)
                  .sort((a, b) => b.firsts - a.firsts || b.rankings - a.rankings)
                  .map((r) => (
                    <tr key={r.id} className="even:bg-foreground/[0.025]">
                      <td className="max-w-[12rem] rounded-l-md px-2 py-1.5">
                        <span className="flex items-center gap-2">
                          <ColorDot color={r.color} />
                          <span className="truncate">{r.name}</span>
                        </span>
                      </td>
                      {ranks.map((n) => (
                        <td
                          key={n}
                          className={cn(
                            "px-2 py-1.5 text-right font-mono text-xs",
                            !r.byRank[n] && "text-muted-foreground/50",
                            n === 1 && "font-semibold",
                          )}
                        >
                          {r.byRank[n] ?? 0}
                        </td>
                      ))}
                      <td className="rounded-r-md px-2 py-1.5 text-right font-mono text-xs font-semibold">{r.rankings}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}
    </div>
  );
}
