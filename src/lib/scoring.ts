// Families (groups of projects) and the per-semester points competition between
// them. Row shapes and the pure helpers the scoreboard renders with.
//
// Keep in sync with migration 0103_families_and_scoring.sql — the Supabase
// clients in this app are untyped, so these are the canonical shapes. The
// `*_standings` / `*_scores` / `*_ledger` types mirror an RPC's OUT columns
// exactly, including the snake_case.

export type Family = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
};

export type Semester = {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
};

// family_standings(). `rank` comes from SQL rank(), so tied families share a
// position and the sequence can skip (1, 2, 2, 4).
export type FamilyStanding = {
  family_id: string;
  family_name: string;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  points: number;
  project_count: number;
  award_count: number;
  rank: number;
};

// project_scores(). `family_id` is null for a project with no family that still
// has live points this semester — that's how the Scoring tab flags awards which
// aren't counting for anyone yet.
export type ProjectScore = {
  family_id: string | null;
  project_id: string;
  project_name: string;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  points: number;
  award_count: number;
};

// score_ledger(). Includes voided rows; the UI filters them behind a toggle.
export type LedgerEntry = {
  id: string;
  project_id: string;
  project_name: string;
  family_id: string | null;
  family_name: string | null;
  family_color: string | null;
  points: number;
  reason: string;
  awarded_on: string;
  awarded_by: string | null;
  awarded_by_name: string | null;
  created_at: string;
  voided_at: string | null;
};

// Quick-set amounts in the award dialog.
export const POINT_PRESETS = [5, 10, 25, 50, 100];

// Mirror score_entries' CHECK constraints so the form rejects what the database
// would reject anyway, before a round trip.
export const POINTS_MIN = -10000;
export const POINTS_MAX = 10000;
export const REASON_MAX = 500;

/**
 * Width of a standings bar as a percentage of the leader's.
 *
 * The leader is always exactly 100%. A non-zero total is floored at 2% so a
 * family on three points renders as a visible sliver rather than an invisible
 * hairline, and anything at or below zero gets no bar at all (a negative total
 * is real, but there is no sensible direction to draw it in — the number itself
 * carries that).
 */
export function barPct(points: number, leader: number): number {
  if (!Number.isFinite(points) || !Number.isFinite(leader)) return 0;
  if (points <= 0 || leader <= 0) return 0;
  if (points >= leader) return 100;
  return Math.max(2, Math.round((points / leader) * 100));
}

/** Signed display for a ledger amount: "+25" / "−10" (a real minus sign). */
export function formatPoints(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

/** "3 projects" / "1 project" — the count line under a family's name. */
export function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Group project rows under their family id. Projects with no family land under
 * the `null` key, which the Scoring tab surfaces as a warning. Each bucket
 * keeps project_scores' ordering (points desc, then name).
 */
export function groupByFamily(rows: ProjectScore[]): Map<string | null, ProjectScore[]> {
  const out = new Map<string | null, ProjectScore[]>();
  for (const row of rows) {
    const bucket = out.get(row.family_id);
    if (bucket) bucket.push(row);
    else out.set(row.family_id, [row]);
  }
  return out;
}

/**
 * `T2` when a rank is shared with a neighbour, otherwise `2`. Takes anything
 * carrying a `rank` so the family standings and the ranked project list — whose
 * ranks come from `rankProjects` rather than SQL — share one label.
 */
export function rankLabel(rows: { rank: number }[], i: number): string {
  const r = rows[i].rank;
  const tied =
    (i > 0 && rows[i - 1].rank === r) ||
    (i < rows.length - 1 && rows[i + 1].rank === r);
  return tied ? `T${r}` : String(r);
}

// A project row with the position it holds in the cross-family ranking. Not an
// RPC shape: project_scores returns the rows already ordered but unnumbered,
// because a project's rank only means something once you've decided which
// projects are in the running.
export type RankedProject = ProjectScore & { rank: number };

/**
 * Number project rows for the Projects standings, SQL `rank()`-style: ties
 * share a position and the sequence skips after one (1, 2, 2, 4), matching
 * `FamilyStanding.rank` so `rankLabel` reads the same in both views.
 *
 * Sorts its own input (points desc, then name) rather than trusting
 * project_scores' ordering — the ranks have to agree with the order they're
 * rendered in, and that's cheap enough to guarantee here.
 */
export function rankProjects(rows: ProjectScore[]): RankedProject[] {
  const sorted = [...rows].sort(
    (a, b) => b.points - a.points || a.project_name.localeCompare(b.project_name),
  );
  const out: RankedProject[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const prev = out[i - 1];
    // Same score as the row above: share its rank. Otherwise take this row's
    // own position, which is what makes the sequence skip past a tie.
    out.push({
      ...sorted[i],
      rank: prev && prev.points === sorted[i].points ? prev.rank : i + 1,
    });
  }
  return out;
}

/**
 * Does a ledger row match the points log's search box? Case-insensitive
 * substring over the columns the reader can actually see as text: project,
 * family, reason, awarder.
 *
 * Not the amount — typing "5" would hit every reason containing a 5 — and not
 * `awarded_on`, which is an ISO date the table never shows in that form, so
 * "Oct" wouldn't match "2026-10-06" and the box would feel broken.
 */
export function ledgerMatches(e: LedgerEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [e.project_name, e.family_name, e.reason, e.awarded_by_name].some((field) =>
    field?.toLowerCase().includes(q),
  );
}
