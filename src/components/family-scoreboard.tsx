"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, Trophy } from "lucide-react";
import { FamilyMark } from "@/components/family-mark";
import { ScoreboardCompactSkeleton, ScoreboardSkeleton } from "@/components/skeletons";
import { accentFill, accentTint, DEFAULT_ACCENT } from "@/lib/portal-color";
import { useScoreboard } from "@/lib/use-scoreboard";
import { useSemesters } from "@/lib/use-semesters";
import {
  barPct,
  countLabel,
  rankLabel,
  type FamilyStanding,
  type ProjectScore,
} from "@/lib/scoring";

// Every family gets a card, in rank order — there are only ever a handful, so
// showing all of them beats a top-three podium that hides the rest. Plain
// left-to-right order: the trophy marks the leader, so the 2nd-1st-3rd staging
// a three-card podium needed would only confuse a row of five.
//
// Card height is the score, drawn as a column. The floor has to clear the
// contents' own natural height (mark, name, total, project count — about
// 170px), or every card below that score collapses to the same size and the
// bottom of the range stops meaning anything. The grid aligns to the bottom so
// they read as bars standing on one baseline.
const CARD_MIN_H = 176;
const CARD_MAX_H = 264;

function cardHeight(points: number, leader: number): number {
  return CARD_MIN_H + (barPct(points, leader) / 100) * (CARD_MAX_H - CARD_MIN_H);
}

// Leader mark. Lucide's Trophy can't do this: filling it solidifies the two
// handles, which are meant to read as open loops, and its bottom path is a
// ground line we don't want. Cup and base are filled, handles stay outlines.
function TrophyMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Handles: outline only, so they stay open loops either side of the cup. */}
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      {/* Cup. */}
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" fill="currentColor" />
      {/* Stem flaring into a solid plinth — no separate ground line beneath. */}
      <path
        d="M10.5 14.5h3V18h2.5a1 1 0 0 1 1 1v1.5h-10V19a1 1 0 0 1 1-1h2.5z"
        fill="currentColor"
      />
    </svg>
  );
}

// A project's segment color: its own accent when it has one, else a stepped
// tint of the family's so segments stay distinguishable but still read as that
// family's bar.
function segmentColor(project: ProjectScore, familyColor: string | null, i: number): string {
  if (project.color) return project.color;
  return accentTint(familyColor || DEFAULT_ACCENT, Math.max(30, 100 - i * 14)) ?? DEFAULT_ACCENT;
}

function PodiumCard({
  s,
  leader,
  leading,
}: {
  s: FamilyStanding;
  leader: number;
  leading: boolean;
}) {
  // Painted in the raw accent under the same sheen as a portal card's hover
  // swipe, rather than a tint of it — these cards are the page's one big
  // expression of a family's colour, so they wear it at full strength and let
  // readableTextColor pick the text that survives on top.
  return (
    // The trophy sits in flow ABOVE the card rather than straddling its edge, so
    // it never overlaps the accent and only ever has the page behind it. That
    // makes the row a touch taller for the leader; the grid is items-end, so
    // every card still stands on the same baseline.
    <div className="flex flex-col">
      {leading && (
        // Family accent at full opacity — same colour as the card beneath, so
        // the mark reads as belonging to the leader without stroke/fill seams.
        <span
          className="mx-auto mb-2"
          role="img"
          aria-label="Leading"
          style={{ color: s.color || DEFAULT_ACCENT }}
        >
          <TrophyMark size={28} />
        </span>
      )}
      <div
        className="relative overflow-hidden rounded-xl p-4 pt-5 flex flex-col items-center justify-end gap-2 text-center"
        style={{ minHeight: cardHeight(s.points, leader), ...accentFill(s.color || DEFAULT_ACCENT) }}
      >
        <span
          className="absolute left-2.5 top-1 text-4xl font-black tabular-nums select-none opacity-30"
          aria-hidden
        >
          {s.rank}
        </span>
        <FamilyMark
          icon={s.icon}
          iconUrl={s.icon_url}
          color={s.color}
          name={s.family_name}
          size={44}
          onAccent
        />
        <p className="text-sm font-semibold leading-tight line-clamp-2">{s.family_name}</p>
        <p className="text-2xl font-bold tabular-nums">{s.points}</p>
        <p className="text-[11px] opacity-70">{countLabel(s.project_count, "project")}</p>
      </div>
    </div>
  );
}

function FamilyRow({
  s,
  index,
  standings,
  leader,
  projects,
  expanded,
  onToggle,
}: {
  s: FamilyStanding;
  index: number;
  standings: FamilyStanding[];
  leader: number;
  projects: ProjectScore[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const accent = s.color || DEFAULT_ACCENT;
  const scoring = projects.filter((p) => p.points > 0);
  const idle = projects.filter((p) => p.points <= 0);
  // Intra-family bars scale to that family's own best project, so a last-place
  // family's breakdown is still readable.
  const familyBest = scoring.reduce((max, p) => Math.max(max, p.points), 0);
  // The breakdown bar mirrors the family's own bar exactly, so the segments
  // read as that bar taken apart rather than as a second, bigger total.
  const familyBarPct = barPct(s.points, leader);
  const panelId = `family-breakdown-${s.family_id}`;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full text-left px-4 py-3 flex flex-col gap-2 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground flex-shrink-0">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <span className="w-7 text-right text-xs font-medium tabular-nums text-muted-foreground flex-shrink-0">
            {rankLabel(standings, index)}
          </span>
          <FamilyMark
            icon={s.icon}
            iconUrl={s.icon_url}
            color={s.color}
            name={s.family_name}
            size={32}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{s.family_name}</p>
            <p className="text-xs text-muted-foreground">
              {countLabel(s.project_count, "project")} · {countLabel(s.award_count, "award")}
            </p>
          </div>
          <span
            className={`text-lg font-bold tabular-nums flex-shrink-0 ${
              s.points < 0 ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {s.points}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-foreground/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${familyBarPct}%`, backgroundColor: accent }}
          />
        </div>
      </button>

      {expanded && (
        <div id={panelId} className="px-4 pb-4 pt-3 bg-accent/20 flex flex-col gap-3">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects in this family yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {scoring.map((p, i) => (
                <div key={p.project_id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{p.project_name}</span>
                  <div className="w-24 h-1.5 rounded-full bg-foreground/10 overflow-hidden flex-shrink-0">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barPct(p.points, familyBest)}%`,
                        backgroundColor: segmentColor(p, s.color, i),
                      }}
                    />
                  </div>
                  <span className="w-12 text-right tabular-nums font-medium flex-shrink-0">
                    {p.points}
                  </span>
                </div>
              ))}
              {idle.map((p) => (
                <div
                  key={p.project_id}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span className="flex-1 truncate">{p.project_name}</span>
                  <span className="text-xs">
                    {p.points < 0 ? "" : "no points yet"}
                  </span>
                  <span className="w-12 text-right tabular-nums flex-shrink-0">
                    {p.points < 0 ? p.points : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border rounded-xl px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * The full scoreboard: a podium for the top three, then every family as a
 * ranked row whose bar is scaled to the leader, each expanding to show which
 * projects carried it.
 *
 * Everything here is a div with an inline width or flexGrow rather than a
 * chart: there's no chart library in this app, and a family's accent comes from
 * ColorPicker as per-row data, so it has to go through inline styles and the
 * portal-color helpers (which mix against the theme background) the same way
 * portal cards do.
 *
 * Pure: takes already-loaded standings so the layout can be rendered (and
 * eyeballed) without a database behind it. `FamilyScoreboard` below is the
 * fetching wrapper the app actually mounts.
 */
export function FamilyStandingsView({
  standings,
  byFamily,
  leader,
  totalPoints,
  totalAwards,
  semesterName,
}: {
  standings: FamilyStanding[];
  byFamily: Map<string | null, ProjectScore[]>;
  leader: number;
  totalPoints: number;
  totalAwards: number;
  semesterName: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const scoringStarted = totalPoints !== 0 || totalAwards > 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{semesterName}</span>
        {scoringStarted && (
          <>
            {" · "}
            {totalPoints} point{totalPoints === 1 ? "" : "s"} awarded {" · "}
            {countLabel(totalAwards, "award")}
          </>
        )}
      </p>

      {!scoringStarted && (
        <EmptyCard>No points awarded yet this semester.</EmptyCard>
      )}

      {scoringStarted && leader > 0 && (
        <div
          className="grid items-end gap-3"
          // auto-fit rather than a fixed column count: four families shouldn't
          // leave a hole where a fifth would go, and they wrap on narrow screens.
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
        >
          {standings.map((s) => (
            <PodiumCard
              key={s.family_id}
              s={s}
              leader={leader}
              leading={s.rank === 1 && s.points > 0}
            />
          ))}
        </div>
      )}

      <div className="border rounded-xl divide-y overflow-hidden">
        {standings.map((s, i) => (
          <FamilyRow
            key={s.family_id}
            s={s}
            index={i}
            standings={standings}
            leader={leader}
            projects={byFamily.get(s.family_id) ?? []}
            expanded={expanded.has(s.family_id)}
            onToggle={() => toggle(s.family_id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The dashboard sidebar's standings glance: the same ranked rows and the same
 * bar scale as the page, at 320px. Pure, for the same reason as
 * FamilyStandingsView.
 */
export function FamilyStandingsCompact({
  standings,
  leader,
  semesterName,
}: {
  standings: FamilyStanding[];
  leader: number;
  semesterName: string;
}) {
  return (
    <div className="border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Standings
        </h2>
        <Link
          href="/scoreboard"
          className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all
          <ArrowRight
            size={12}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">{semesterName}</p>

      <div className="flex flex-col gap-2.5">
        {standings.map((s, i) => (
          <div key={s.family_id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="w-3 text-[10px] tabular-nums text-muted-foreground flex-shrink-0">
                {s.rank}
              </span>
              <FamilyMark
                icon={s.icon}
                iconUrl={s.icon_url}
                color={s.color}
                name={s.family_name}
                size={16}
              />
              <span
                className={`flex-1 truncate text-xs ${i === 0 ? "font-semibold" : "font-medium"}`}
              >
                {s.family_name}
              </span>
              {i === 0 && leader > 0 && (
                <Trophy size={11} className="text-muted-foreground flex-shrink-0" aria-hidden/>
              )}
              <span
                className={`text-xs font-bold tabular-nums flex-shrink-0 ${
                  s.points < 0 ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {s.points}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${barPct(s.points, leader)}%`,
                  backgroundColor: s.color || DEFAULT_ACCENT,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What the /scoreboard page mounts: loads one semester's standings and hands
 * them to FamilyStandingsView, or explains why there's nothing to show.
 */
export function FamilyScoreboard({
  semesterId,
  semesterName,
  reloadToken = 0,
}: {
  semesterId: string | null;
  semesterName: string | null;
  /** Bump to refetch — how exec's award/void controls refresh the board. */
  reloadToken?: number;
}) {
  const { standings, byFamily, leader, totalPoints, totalAwards, error } =
    useScoreboard(semesterId, reloadToken);

  if (standings === null) return <ScoreboardSkeleton />;
  if (error) return <EmptyCard>{error}</EmptyCard>;
  if (!semesterId) return <EmptyCard>No semester is active yet.</EmptyCard>;
  if (standings.length === 0) return <EmptyCard>No families have been set up yet.</EmptyCard>;

  return (
    <FamilyStandingsView
      standings={standings}
      byFamily={byFamily}
      leader={leader}
      totalPoints={totalPoints}
      totalAwards={totalAwards}
      semesterName={semesterName}
    />
  );
}

/**
 * What the dashboard sidebar mounts. Renders nothing at all when there's no
 * active semester or no families, so a fresh database doesn't grow an empty box
 * under the calendar — which is also what keeps the dashboard intact before
 * migration 0103 has been applied.
 */
export function FamilyScoreboardCard() {
  const { active } = useSemesters();
  const { standings, leader } = useScoreboard(active?.id ?? null);

  if (standings === null) return <ScoreboardCompactSkeleton />;
  if (!active || standings.length === 0) return null;

  return (
    <FamilyStandingsCompact standings={standings} leader={leader} semesterName={active.name} />
  );
}
