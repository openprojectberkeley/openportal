"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, Trophy } from "lucide-react";
import { FamilyMark } from "@/components/family-mark";
import { ScoreboardCompactSkeleton, ScoreboardSkeleton } from "@/components/skeletons";
import { accentStyle, accentTint, DEFAULT_ACCENT } from "@/lib/portal-color";
import { useScoreboard } from "@/lib/use-scoreboard";
import { useSemesters } from "@/lib/use-semesters";
import {
  barPct,
  countLabel,
  rankLabel,
  type FamilyStanding,
  type ProjectScore,
} from "@/lib/scoring";

// Podium card heights. The grid is items-end, so a taller first card plus these
// two produces the podium silhouette with no absolute positioning.
const PODIUM_HEIGHT = ["min-h-44", "min-h-36", "min-h-36"];
// Visual order 2nd · 1st · 3rd from sm up, while DOM order stays 1-2-3 so
// screen readers and the mobile stack read it as a ranked list.
const PODIUM_ORDER = ["order-1 sm:order-2", "order-2 sm:order-1", "order-3"];

// A project's segment color: its own accent when it has one, else a stepped
// tint of the family's so segments stay distinguishable but still read as that
// family's bar.
function segmentColor(project: ProjectScore, familyColor: string | null, i: number): string {
  if (project.color) return project.color;
  return accentTint(familyColor || DEFAULT_ACCENT, Math.max(30, 100 - i * 14)) ?? DEFAULT_ACCENT;
}

function PodiumCard({ s, slot }: { s: FamilyStanding; slot: number }) {
  const accent = s.color || DEFAULT_ACCENT;
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-4 flex flex-col items-center justify-end gap-2 text-center ${PODIUM_HEIGHT[slot]} ${PODIUM_ORDER[slot]}`}
      style={{
        ...accentStyle(s.color),
        ...(slot === 0 ? { boxShadow: `inset 0 0 0 1px ${accent}` } : {}),
      }}
    >
      <span
        className="absolute right-2 top-1 text-4xl font-black tabular-nums text-foreground/10 select-none"
        aria-hidden
      >
        {s.rank}
      </span>
      {slot === 0 && <Trophy size={14} style={{ color: accent }} aria-hidden />}
      <FamilyMark
        icon={s.icon}
        iconUrl={s.icon_url}
        color={s.color}
        name={s.family_name}
        size={slot === 0 ? 56 : 44}
      />
      <p className="text-sm font-semibold leading-tight line-clamp-2">{s.family_name}</p>
      <p className={`font-bold tabular-nums ${slot === 0 ? "text-3xl" : "text-2xl"}`}>{s.points}</p>
      <p className="text-[11px] text-muted-foreground">{countLabel(s.project_count, "project")}</p>
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
            <>
              {scoring.length > 0 && familyBarPct > 0 && (
                <div
                  className="flex h-2 overflow-hidden rounded-full"
                  style={{ width: `${familyBarPct}%` }}
                  role="img"
                  aria-label={`How ${s.family_name}'s points break down by project`}
                >
                  {scoring.map((p, i) => (
                    <div
                      key={p.project_id}
                      title={`${p.project_name}: ${p.points}`}
                      style={{
                        flexGrow: p.points,
                        flexBasis: 0,
                        backgroundColor: segmentColor(p, s.color, i),
                      }}
                    />
                  ))}
                </div>
              )}
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
            </>
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

      {scoringStarted && standings.length >= 3 && leader > 0 && (
        <div className="grid grid-cols-3 gap-3 items-end">
          {standings.slice(0, 3).map((s, i) => (
            <PodiumCard key={s.family_id} s={s} slot={i} />
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
                <Trophy size={11} className="text-muted-foreground flex-shrink-0" aria-hidden />
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
}: {
  semesterId: string | null;
  semesterName: string | null;
}) {
  const { standings, byFamily, leader, totalPoints, totalAwards, error } =
    useScoreboard(semesterId);

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
