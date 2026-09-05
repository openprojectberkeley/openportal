import { rankLabel } from "@/lib/application-rank";
import { DonutChart, Legend, type Segment } from "@/components/donut-chart";

// Monotone single-hue ramp: darkest for 1st choice, lightening toward the last.
// `i` is the slice's position (0 = 1st choice) out of `n` slices shown.
function monotoneColor(i: number, n: number): string {
  const light = 72;
  const dark = 32;
  const l = n <= 1 ? 52 : dark + (light - dark) * (i / (n - 1));
  return `hsl(245 55% ${l}%)`;
}

// Inline (non-modal) pie of the selected project's rank distribution: how many
// of its applicants ranked it 1st, 2nd, … Shown in the manager page's left
// column, below the roster. Presentational — the page computes the counts from
// the already-loaded applicant list.
export function ProjectRankDistribution({
  distribution,
  total,
}: {
  // Sorted by rank ascending; only ranks with applicants need be present.
  distribution: { rank: number; count: number }[];
  total: number;
}) {
  if (total === 0 || distribution.length === 0) return null;

  // distribution is sorted by rank ascending, so index 0 is the 1st choice.
  const segments: Segment[] = distribution.map(({ rank, count }, i) => ({
    label: rankLabel(rank),
    value: count,
    color: monotoneColor(i, distribution.length),
  }));

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Rank distribution
      </h3>
      <div className="flex items-center gap-4">
        <DonutChart segments={segments} total={total} centerValue={`${total}`} centerSub="applicants" />
        <div className="min-w-0 flex-1">
          <Legend segments={segments} total={total} />
        </div>
      </div>
    </div>
  );
}
