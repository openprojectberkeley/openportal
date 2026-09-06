// Dependency-free SVG donut chart + legend, shared by the recruiting-analytics
// modal and the per-project rank pie. Circumference is normalized to 100
// (r ≈ 15.9155) so each arc's dasharray length equals its percentage.

export type Segment = { label: string; value: number; color: string };

// Theme-aware neutral for "nothing"/empty slices.
export const NEUTRAL = "hsl(var(--muted-foreground) / 0.3)";

export function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

export function DonutChart({
  segments,
  total,
  centerValue,
  centerSub,
}: {
  segments: Segment[];
  total: number;
  centerValue: string;
  centerSub: string;
}) {
  const R = 15.915494; // circumference = 2πR = 100
  const strokeWidth = 4;
  // Rotate the ring so the origin sits at 12 o'clock, then advance each arc
  // clockwise via a negative dashoffset = sum of the preceding arcs' lengths.
  let cumulative = 0;
  const arcs =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (s.value / total) * 100;
            const arc = { color: s.color, len, dashoffset: -cumulative };
            cumulative += len;
            return arc;
          })
      : [];

  return (
    <svg viewBox="0 0 36 36" className="h-32 w-32" role="img" aria-label={centerValue}>
      <circle cx="18" cy="18" r={R} fill="none" stroke={NEUTRAL} strokeWidth={strokeWidth} />
      {arcs.map((a, i) => (
        <circle
          key={i}
          cx="18"
          cy="18"
          r={R}
          fill="none"
          stroke={a.color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${a.len} ${100 - a.len}`}
          strokeDashoffset={a.dashoffset}
          strokeLinecap="butt"
          transform="rotate(-90 18 18)"
        />
      ))}
      <text x="18" y="17" textAnchor="middle" className="fill-foreground" style={{ fontSize: 5, fontWeight: 700 }}>
        {centerValue}
      </text>
      <text x="18" y="22.5" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 2.6 }}>
        {centerSub}
      </text>
    </svg>
  );
}

export function Legend({ segments, total }: { segments: Segment[]; total: number }) {
  return (
    <ul className="flex flex-col gap-1">
      {segments.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: s.color }} />
          <span className="text-foreground/90">{s.label}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">
            {s.value} ({pct(s.value, total)}%)
          </span>
        </li>
      ))}
    </ul>
  );
}
