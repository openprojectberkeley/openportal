// Exec-only application funnel stats for one period, shown on the Applications
// manager page above the list. Fed by the `application_period_stats` RPC (0053).
// One compact line, not tiles: the numbers are simple. `stats === null`
// renders a text-line skeleton so it doesn't flash.

export type Stats = {
  empty_drafts: number;
  unfinished_drafts: number;
  submitted: number;
  accepted: number;
  rejected: number;
};

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="font-medium tabular-nums text-foreground">{value}</span> {label}
    </span>
  );
}

export function ApplicationStats({ stats }: { stats: Stats | null }) {
  if (stats === null) {
    return <span className="block h-3.5 w-96 max-w-full animate-pulse rounded-full bg-foreground/[0.09]" aria-hidden />;
  }

  const completed = stats.submitted + stats.accepted + stats.rejected;
  const dot = <span aria-hidden className="text-muted-foreground/50">·</span>;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground animate-fade-in-up">
      <Stat value={completed} label="completed" />
      {dot}
      <Stat value={stats.unfinished_drafts} label="unfinished" />
      {dot}
      <Stat value={stats.empty_drafts} label="empty" />
      <span aria-hidden className="mx-1 h-3.5 w-px bg-foreground/15" />
      <Stat value={stats.submitted} label="pending" />
      {dot}
      <Stat value={stats.accepted} label="accepted" />
      {dot}
      <Stat value={stats.rejected} label="rejected" />
    </p>
  );
}
