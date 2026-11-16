"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { FamilyMark } from "@/components/family-mark";
import { ScoreboardCompactSkeleton, ScoreboardSkeleton } from "@/components/skeletons";
import { accentTint, DEFAULT_ACCENT, visibleMarkColor } from "@/lib/portal-color";
import { cn } from "@/lib/utils";
import { staggerStyle } from "@/lib/motion";
import { useScoreboard } from "@/lib/use-scoreboard";
import { useSemesters } from "@/lib/use-semesters";
import {
  barPct,
  countLabel,
  rankLabel,
  rankProjects,
  type FamilyStanding,
  type ProjectScore,
} from "@/lib/scoring";
import { TabStrip } from "@/components/ui/tab-strip";

/**
 * A score bar's fill. The bar is always full width and clipped to its length,
 * so a change in score animates without reflowing the row (clip-path repaints;
 * width would re-run layout) and the rounded end stays round at any length (a
 * scaleX would squash it). `index` staggers the first-paint draw-in so the
 * bars land top to bottom.
 */
function barFill(pct: number, index: number, color: string): React.CSSProperties {
  return {
    clipPath: `inset(0 ${100 - pct}% 0 0 round 9999px)`,
    animationDelay: `${index * 40}ms`,
    backgroundColor: visibleMarkColor(color),
  };
}

const BAR_FILL_CLASS =
  "h-full w-full rounded-full animate-bar-in transition-[clip-path] duration-700 ease-out-expo";

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

// A project's bar in the cross-family Projects list: its own accent, else its
// family's flat. Deliberately NOT segmentColor — that steps the tint down by
// position to separate siblings inside one family's breakdown, which across a
// global list of twenty would fade the tail to nothing. Two projects of the
// same family sharing a colour is fine here, because every row names its
// family next to the bar.
function projectBarColor(p: ProjectScore, familyColor: string | null | undefined): string {
  return p.color || familyColor || DEFAULT_ACCENT;
}

/**
 * One ranked line, shared by the family board, the project board and (in
 * spirit) the dashboard glance, so every standings view reads as the same
 * chart: rank, mark, name, a hairline bar scaled to the top score, and the
 * total pinned to one right edge. Colour appears once per line — in the bar —
 * so a page of standings is a column of comparable lengths, not a wall of
 * painted tiles.
 *
 * The bar sits inline from sm up and drops under the name on phones, where a
 * 40px sliver between name and score would compare nothing.
 */
function StandingLine({
  lead,
  rank,
  mark,
  name,
  meta,
  pct,
  index,
  color,
  points,
  leading = false,
}: {
  /** Leading control slot (the family row's disclosure chevron). */
  lead?: React.ReactNode;
  rank: string;
  mark: React.ReactNode;
  name: string;
  meta: React.ReactNode;
  pct: number;
  index: number;
  color: string;
  points: number;
  leading?: boolean;
}) {
  const bar = (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
      <span className={cn("block", BAR_FILL_CLASS)} style={barFill(pct, index, color)} />
    </span>
  );
  return (
    <span className="flex flex-col gap-2">
      <span className="flex items-center gap-3">
        {lead}
        <span className="w-7 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {rank}
        </span>
        {mark}
        <span className="min-w-0 flex-1 sm:w-56 sm:flex-none">
          <span className={cn("block truncate text-sm", leading ? "font-semibold" : "font-medium")}>
            {name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{meta}</span>
        </span>
        <span className="hidden min-w-0 flex-1 sm:block">{bar}</span>
        <span
          className={cn(
            "flex w-16 shrink-0 items-center justify-end gap-1.5 font-mono text-base font-semibold tabular-nums",
            points < 0 && "text-destructive",
          )}
        >
          {leading && (
            <span role="img" aria-label="Leading" className="text-muted-foreground">
              <TrophyMark size={14} />
            </span>
          )}
          {points}
        </span>
      </span>
      <span className="sm:hidden">{bar}</span>
    </span>
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
    <div className="animate-fade-in-up" style={staggerStyle(index)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full rounded-lg text-left px-4 py-3 transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:bg-foreground/[0.04]"
      >
        <StandingLine
          lead={
            <span className="shrink-0 text-muted-foreground">
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          }
          rank={rankLabel(standings, index)}
          mark={
            <FamilyMark icon={s.icon} iconUrl={s.icon_url} color={s.color} name={s.family_name} size={28} />
          }
          name={s.family_name}
          meta={`${countLabel(s.project_count, "project")} · ${countLabel(s.award_count, "award")}`}
          pct={familyBarPct}
          index={index}
          color={accent}
          points={s.points}
          leading={s.rank === 1 && s.points > 0}
        />
      </button>

      {expanded && (
        <div id={panelId} className="mb-1 flex flex-col gap-3 rounded-lg surface px-4 py-3 sm:pl-[6.75rem]">
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
                  <span className="w-12 text-right font-mono tabular-nums font-medium flex-shrink-0">
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
                  <span className="w-12 text-right font-mono tabular-nums flex-shrink-0">
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
    <div className="rounded-xl surface px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

const TABS = [
  { id: "families", label: "Families" },
  { id: "projects", label: "Projects" },
] as const;

type ScoreboardTab = (typeof TABS)[number]["id"];

/**
 * The Families / Projects switch above the board.
 *
 * Same underline strip as the Admin page's tabs, but with the ARIA that one
 * never grew: a real tablist with roving tabindex and arrow-key movement, so
 * the two views are reachable without a mouse. Local to this file rather than a
 * ui/ primitive — there's one consumer, and the admin strip's per-tab counts
 * and lack of panels make a shared component a worse fit than a copy.
 *
 * No ?view= search param: the page's own note is that nothing there reads
 * request-time state, which is what lets it skip a Suspense boundary under
 * cacheComponents. useSearchParams would take that away for a toggle nobody
 * needs to link to.
 */
function ScoreboardTabs({
  tab,
  onTab,
  counts,
}: {
  tab: ScoreboardTab;
  onTab: (t: ScoreboardTab) => void;
  counts: Partial<Record<ScoreboardTab, number>>;
}) {
  return (
    <TabStrip
      aria-label="Scoreboard view"
      idPrefix="scoreboard-tab"
      panelId={(id) => `scoreboard-panel-${id}`}
      value={tab}
      onChange={onTab}
      tabs={TABS.map((t) => ({ value: t.id, label: t.label, count: counts[t.id] }))}
    />
  );
}

/**
 * The full scoreboard: every family as one ranked line whose bar is scaled to
 * the leader, each expanding to show which projects carried it. No podium: it
 * repeated the list above the list, and the meta line now says the one thing it
 * added (who leads, by how much).
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
  // The one sentence the old podium was trying to say, said plainly.
  const margin =
    standings.length > 1 && standings[0].points > standings[1].points
      ? standings[0].points - standings[1].points
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs tabular-nums text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{semesterName}</span>
        {scoringStarted && (
          <>
            {" · "}
            {totalPoints} point{totalPoints === 1 ? "" : "s"} awarded {" · "}
            {countLabel(totalAwards, "award")}
            {margin > 0 && (
              <>
                {" · "}
                <span className="text-foreground">
                  {standings[0].family_name} lead by {margin}
                </span>
              </>
            )}
          </>
        )}
      </p>

      {!scoringStarted && (
        <EmptyCard>No points awarded yet this semester.</EmptyCard>
      )}

      <div className="flex flex-col">
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
 * The Projects tab: every project that belongs to a family, ranked against
 * every other project rather than only against its siblings.
 *
 * The family view answers "who's winning"; this one answers "what's actually
 * carrying it", which the per-family breakdown can't — a mid-table family's
 * strongest project can outscore the leader's weakest, and nesting hides that.
 *
 * Only family-assigned projects reach here (the caller filters): those are the
 * ones in the competition. A project with no family has points that count for
 * nobody, which the page already says out loud to the one person who can fix it
 * instead of ranking it against projects that do count.
 *
 * Pure, like FamilyStandingsView — bars are divs with an inline width, since
 * there's no chart library and the accents are per-row data.
 */
export function ProjectStandingsView({
  projects,
  standings,
  totalPoints,
  totalAwards,
  semesterName,
}: {
  /** project_scores rows, already filtered to projects with a family. */
  projects: ProjectScore[];
  /** For the family a project belongs to — project_scores carries only its id. */
  standings: FamilyStanding[];
  totalPoints: number;
  totalAwards: number;
  semesterName: string | null;
}) {
  // Keyed loosely so a row's own `family_id` (nullable on the RPC shape, though
  // the caller has filtered the nulls out) can be looked up without a cast.
  const families = useMemo(
    () => new Map<string | null, FamilyStanding>(standings.map((f) => [f.family_id, f])),
    [standings],
  );

  // Anything that moved gets ranked, in either direction — a penalty is a
  // result, and rankProjects already sorts it to the bottom. Only projects
  // sitting on a true zero go to the tail: numbering a dozen of those would be
  // noise, and they have nothing to say yet.
  const scoring = projects.filter((p) => p.points !== 0);
  const idle = projects.filter((p) => p.points === 0);
  const ranked = rankProjects(scoring);
  // Bars scale to the best project, the way the family list scales to the leader.
  const top = ranked[0]?.points ?? 0;

  if (projects.length === 0) {
    return <EmptyCard>No projects have been assigned to a family yet.</EmptyCard>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs tabular-nums text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{semesterName}</span>
        {" · "}
        {countLabel(projects.length, "project")}
        {(totalPoints !== 0 || totalAwards > 0) && (
          <>
            {" · "}
            {totalPoints} point{totalPoints === 1 ? "" : "s"} awarded {" · "}
            {countLabel(totalAwards, "award")}
          </>
        )}
      </p>

      {ranked.length === 0 ? (
        <EmptyCard>No points awarded yet this semester.</EmptyCard>
      ) : (
        <div className="flex flex-col">
          {ranked.map((p, i) => {
            const family = families.get(p.family_id);
            return (
              <div key={p.project_id} className="rounded-lg px-4 py-3 animate-fade-in-up" style={staggerStyle(i)}>
                <StandingLine
                  rank={rankLabel(ranked, i)}
                  mark={
                    <FamilyMark
                      icon={family?.icon ?? null}
                      iconUrl={family?.icon_url ?? null}
                      color={family?.color ?? null}
                      name={family?.family_name ?? p.project_name}
                      size={28}
                    />
                  }
                  name={p.project_name}
                  meta={`${family?.family_name ?? "—"} · ${countLabel(p.award_count, "award")}`}
                  pct={barPct(p.points, top)}
                  index={i}
                  color={projectBarColor(p, family?.color)}
                  points={p.points}
                  leading={i === 0 && p.points > 0 && (ranked[1]?.points ?? -Infinity) < p.points}
                />
              </div>
            );
          })}
        </div>
      )}

      {idle.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight">Not scoring yet</h3>
          <div className="flex flex-col">
            {idle.map((p) => {
              const family = families.get(p.family_id);
              return (
                <div
                  key={p.project_id}
                  className="px-4 py-2.5 flex items-center gap-3 text-sm text-muted-foreground"
                >
                  <span className="flex-1 min-w-0 truncate text-foreground">{p.project_name}</span>
                  <span className="text-xs truncate">{family?.family_name ?? "—"}</span>
                  <span className="w-24 text-right text-xs flex-shrink-0">no points yet</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
    <div className="rounded-xl surface rim-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Standings</h2>
        <Link
          href="/scoreboard"
          className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all
          <ArrowRight
            size={12}
            className="transition-transform duration-instant ease-out-quart group-hover:translate-x-0.5"
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
                <TrophyMark size={12} className="text-muted-foreground flex-shrink-0" />
              )}
              <span
                className={cn(
                  "font-mono text-xs font-semibold tabular-nums flex-shrink-0",
                  s.points < 0 && "text-destructive",
                )}
              >
                {s.points}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-foreground/[0.07] overflow-hidden">
              <div
                className={BAR_FILL_CLASS}
                style={barFill(barPct(s.points, leader), i, s.color || DEFAULT_ACCENT)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What the /scoreboard page mounts: loads one semester's standings once and
 * switches between the two readings of them — families competing, or projects
 * ranked against each other — or explains why there's nothing to show.
 *
 * The tab lives here rather than on the page because this is where the single
 * useScoreboard call is; lifting it would mean either a second fetch of the
 * same two RPCs or handing the rows back down as props. It also means the
 * reader's choice survives a semester switch, since this component isn't
 * remounted when semesterId changes.
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
  const { standings, projects, byFamily, leader, totalPoints, totalAwards, error } =
    useScoreboard(semesterId, reloadToken);
  const [tab, setTab] = useState<ScoreboardTab>("families");

  // The competition is between family-assigned projects. An unassigned one's
  // points count for nobody — the page warns exec about those separately
  // rather than ranking them here.
  const assigned = useMemo(
    () => (projects ?? []).filter((p) => p.family_id !== null),
    [projects],
  );

  // No strip on these four: there's nothing to switch between until there are
  // standings to show, and showing it over an error would just offer the reader
  // a second empty view.
  if (standings === null) return <ScoreboardSkeleton semesterName={semesterName} />;
  if (error) return <EmptyCard>{error}</EmptyCard>;
  if (!semesterId) return <EmptyCard>No semester is active yet.</EmptyCard>;
  if (standings.length === 0) return <EmptyCard>No families have been set up yet.</EmptyCard>;

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      <ScoreboardTabs
        tab={tab}
        onTab={setTab}
        counts={{ families: standings.length, projects: assigned.length }}
      />
      {/* The panel wrapper carries the tab relationship so the views themselves
          stay pure and renderable on their own. */}
      <div
        role="tabpanel"
        id={`scoreboard-panel-${tab}`}
        aria-labelledby={`scoreboard-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "families" ? (
          <FamilyStandingsView
            standings={standings}
            byFamily={byFamily}
            leader={leader}
            totalPoints={totalPoints}
            totalAwards={totalAwards}
            semesterName={semesterName}
          />
        ) : (
          <ProjectStandingsView
            projects={assigned}
            standings={standings}
            totalPoints={totalPoints}
            totalAwards={totalAwards}
            semesterName={semesterName}
          />
        )}
      </div>
    </div>
  );
}

/**
 * What the dashboard sidebar mounts. Renders nothing at all when there's no
 * active semester or no families, so a fresh database doesn't grow an empty box
 * under the calendar — which is also what keeps the dashboard intact before
 * migration 0103 has been applied.
 */
export function FamilyScoreboardCard() {
  const { semesters, active } = useSemesters();
  const { standings, leader } = useScoreboard(active?.id ?? null);

  // Semesters not known yet, or this semester's standings still loading: hold
  // the card's shape. Once semesters resolve with none active, render nothing
  // (rather than a skeleton that then vanishes).
  if (semesters === null) return <ScoreboardCompactSkeleton />;
  if (!active) return null;
  if (standings === null) return <ScoreboardCompactSkeleton semesterName={active.name} />;
  if (standings.length === 0) return null;

  return (
    <div className="animate-fade-in-up">
      <FamilyStandingsCompact standings={standings} leader={leader} semesterName={active.name} />
    </div>
  );
}
