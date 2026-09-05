// Exec-only application funnel stats for one period, shown on the Applications
// manager page above the list. Fed by the `application_period_stats` RPC (0053).
// `stats === null` renders a loading skeleton so it doesn't flash.

export type Stats = {
  empty_drafts: number;
  unfinished_drafts: number;
  submitted: number;
  accepted: number;
  rejected: number;
};

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function ApplicationStats({ stats }: { stats: Stats | null }) {
  if (stats === null) {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[4.75rem] rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-3 w-48 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  const completed = stats.submitted + stats.accepted + stats.rejected;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Empty" value={stats.empty_drafts} />
        <Tile label="Unfinished" value={stats.unfinished_drafts} />
        <Tile label="Completed" value={completed} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Pending review {stats.submitted} · Accepted {stats.accepted} · Rejected {stats.rejected}
      </p>
    </div>
  );
}
