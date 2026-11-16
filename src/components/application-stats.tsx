// Exec-only application funnel stats for one period, shown on the Applications
// manager page above the list. Fed by the `application_period_stats` RPC (0053).
// One compact line, not tiles: the numbers are simple. `stats === null`
// renders the same line with the labels real and only the numbers as shapes.

export type Stats = {
  empty_drafts: number;
  unfinished_drafts: number;
  submitted: number;
  accepted: number;
  rejected: number;
};

function Stat({ value, label }: { value: number | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {value === null ? (
        <span aria-hidden className="inline-block h-3.5 w-4 animate-pulse rounded-sm bg-foreground/[0.09]" />
      ) : (
        <span className="font-medium tabular-nums text-foreground">{value}</span>
      )}
      {label}
    </span>
  );
}

export function ApplicationStats({ stats }: { stats: Stats | null }) {
  const completed = stats ? stats.submitted + stats.accepted + stats.rejected : null;
  const dot = <span aria-hidden className="text-muted-foreground/50">·</span>;

  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground ${stats ? "animate-fade-in-up" : ""}`}>
      <Stat value={completed} label="completed" />
      {dot}
      <Stat value={stats?.unfinished_drafts ?? null} label="unfinished" />
      {dot}
      <Stat value={stats?.empty_drafts ?? null} label="empty" />
      <span aria-hidden className="mx-1 h-3.5 w-px bg-foreground/15" />
      <Stat value={stats?.submitted ?? null} label="pending" />
      {dot}
      <Stat value={stats?.accepted ?? null} label="accepted" />
      {dot}
      <Stat value={stats?.rejected ?? null} label="rejected" />
    </p>
  );
}
