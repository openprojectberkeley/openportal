"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { ColorDot } from "@/components/metric-bar";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { PersonName } from "@/components/person-profile-provider";
import { PortalAttendanceModal } from "@/components/portal-attendance-modal";
import { Section, SectionSkeleton, BarsSkeleton } from "@/components/application-analytics-modal";
import { cn } from "@/lib/utils";
import { staggerStyle } from "@/lib/motion";
import { useSemesters } from "@/lib/use-semesters";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { useAttendanceAnalytics } from "@/lib/use-attendance-analytics";
import { CATEGORY_META, isEventCategory } from "@/lib/event-category";
import type { AttendanceCounts } from "@/lib/attendance";
import {
  AT_RISK_MIN_MARKED,
  AT_RISK_RATE,
  AT_RISK_STREAK,
  type AttendanceAnalytics,
  type HeadlineScope,
  type MemberStat,
  type ProjectStat,
} from "@/lib/attendance-analytics";

// Exec "Attendance" tab on /admin. Project meetings and general meetings (GMs)
// are reported separately everywhere. Unmarked slots count against the
// project's fill-out, never against the member. Definitions live in
// src/lib/attendance-analytics.ts.

const ALL = "__all__";
const LOW_FILL = 80;

const fmtPct = (n: number | null) => (n == null ? "—" : `${n}%`);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function AttendanceAnalyticsPanel() {
  const { semesters, active } = useSemesters();
  const [picked, setPicked] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const semesterId = picked ?? active?.id ?? (semesters ? ALL : null);
  const semester = semesters?.find((s) => s.id === semesterId) ?? null;
  const win =
    semesterId == null
      ? null
      : {
          key: semesterId,
          startsOn: semester?.starts_on ?? null,
          endsOn: semester?.ends_on ?? null,
        };
  const { data, loading, error } = useAttendanceAnalytics(win, nonce);
  const [drill, setDrill] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Past meetings with attendance on. Unmarked counts against the project, not the member.
        </p>
        {semesters !== null && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                {semester?.name ?? "All time"}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {semesters.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => setPicked(s.id)}>
                  {s.name}
                  {s.is_active && <span className="ml-2 text-xs text-muted-foreground">Active</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setPicked(ALL)}>All time</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading || !data ? (
        !error && <PanelSkeleton />
      ) : (
        <Loaded data={data} onDrill={setDrill} />
      )}

      {drill && (
        <PortalAttendanceModal
          portalId={drill}
          open
          onOpenChange={(o) => {
            if (!o) {
              setDrill(null);
              setNonce((n) => n + 1);
            }
          }}
          canManage
        />
      )}
    </div>
  );
}

function Loaded({ data, onDrill }: { data: AttendanceAnalytics; onDrill: (portalId: string) => void }) {
  const h = data.headline;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 animate-fade-in-up">
        <HeadlineGroup
          title="Project meetings"
          s={h.project}
          fillHint="Marked ÷ (meetings × project roster), across every project."
        />
        <HeadlineGroup
          title="General meetings"
          s={h.gm}
          fillHint="Marked ÷ (GMs × active members)."
        />
      </div>

      <ProjectsSection projects={data.projects} onDrill={onDrill} />
      {data.atRisk.length > 0 && <AtRiskSection members={data.atRisk} />}
      {data.gms.length > 0 && <GmSection data={data} />}
      <MembersSection members={data.members} />
    </>
  );
}

// ---- bits -------------------------------------------------------------------

function HeadlineGroup({ title, s, fillHint }: { title: string; s: HeadlineScope | null; fillHint: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Held" value={s ? s.meetings : null} />
        <Stat label="Fill-out" value={s ? `${s.fillOut}%` : null} hint={fillHint} warn={!!s && s.fillOut < LOW_FILL} />
        <Stat label="Attendance" value={s ? `${s.attendance}%` : null} hint="Of what was marked. Excused counts as half." />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: React.ReactNode | null;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl surface rim-card px-4 py-3">
      {value === null ? (
        <div className="flex h-8 items-center">
          <Skeleton className="h-6 w-10" />
        </div>
      ) : (
        <div className={cn("text-2xl font-bold tabular-nums", warn && "text-warning")}>{value}</div>
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {hint && <InfoHint label={`About ${label.toLowerCase()}`}>{hint}</InfoHint>}
      </div>
    </div>
  );
}

function MiniBar({ value, warn }: { value: number; warn?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative block h-1.5 w-16 rounded-full bg-foreground/[0.07]">
        <span
          className={cn("block h-full rounded-full animate-bar-in", warn ? "bg-warning" : "bg-foreground/70")}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className={cn("w-9 text-right font-mono text-xs font-semibold tabular-nums", warn && "text-warning")}>
        {value}%
      </span>
    </span>
  );
}

function Pae({ c }: { c: AttendanceCounts }) {
  return (
    <>
      <span className="text-success">{c.present}</span>
      {" / "}
      <span className={cn(c.absent > 0 && "text-destructive")}>{c.absent}</span>
      {" / "}
      <span className={cn(c.excused > 0 && "text-warning")}>{c.excused}</span>
    </>
  );
}

type SortDir = "asc" | "desc";
function useSort<T, K extends string>(
  rows: T[],
  initial: K,
  initialDir: SortDir,
  get: Record<K, (r: T) => number | string | null>,
) {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const sorted = useMemo(() => {
    // Rows with no value (nothing to rate) always sort last.
    const f = get[key];
    const withVal = rows.filter((r) => f(r) != null);
    const without = rows.filter((r) => f(r) == null);
    withVal.sort((a, b) => {
      const x = f(a)!;
      const y = f(b)!;
      return typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    });
    if (dir === "desc") withVal.reverse();
    return [...withVal, ...without];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir]);
  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("asc");
    }
  };
  return { sorted, key, dir, toggle };
}

function Th<K extends string>({
  k,
  sort,
  children,
  right,
}: {
  k: K;
  sort: { key: K; dir: SortDir; toggle: (k: K) => void };
  children: React.ReactNode;
  right?: boolean;
}) {
  const on = sort.key === k;
  const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("whitespace-nowrap px-2 py-1.5 font-medium", right && "text-right")}>
      <button
        type="button"
        onClick={() => sort.toggle(k)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground")}
      >
        {children}
        {on && <Icon size={12} aria-hidden />}
      </button>
    </th>
  );
}

/** Group label over a run of columns, with a divider on its left edge. */
function GroupTh({ span, children }: { span: number; children?: React.ReactNode }) {
  return (
    <th colSpan={span} className="px-2 pt-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </th>
  );
}

// ---- projects -----------------------------------------------------------------

type ProjectKey = "name" | "taken" | "fill" | "attendance" | "last" | "gmFill" | "gmAttendance";

function ProjectsSection({ projects, onDrill }: { projects: ProjectStat[]; onDrill: (portalId: string) => void }) {
  const sort = useSort<ProjectStat, ProjectKey>(projects, "fill", "asc", {
    name: (p) => p.name,
    taken: (p) => (p.project.held ? p.project.taken / p.project.held : 0),
    fill: (p) => p.project.fillOut,
    attendance: (p) => p.project.attendance,
    last: (p) => p.project.lastTaken ?? "",
    gmFill: (p) => p.gm.fillOut,
    gmAttendance: (p) => p.gm.attendance,
  });

  return (
    <Section
      title="Projects"
      count={projects.length}
      index={1}
      hint="Fill-out: share of roster × meetings that got marked. GM columns use the project's roster at general meetings. Click a project to open its sheet."
    >
      <div className="-mx-1 overflow-x-auto">
        <table className="sheet-zebra sheet-hover w-full min-w-[44rem] text-sm">
          <thead>
            <tr>
              <GroupTh span={1} />
              <GroupTh span={4}>Project meetings</GroupTh>
              <GroupTh span={2}>General meetings</GroupTh>
            </tr>
            <tr className="text-left text-xs text-muted-foreground">
              <Th k="name" sort={sort}>Project</Th>
              <Th k="taken" sort={sort} right>Marked</Th>
              <Th k="fill" sort={sort}>Fill-out</Th>
              <Th k="attendance" sort={sort} right>Attendance</Th>
              <Th k="last" sort={sort} right>Last marked</Th>
              <Th k="gmFill" sort={sort}>Fill-out</Th>
              <Th k="gmAttendance" sort={sort} right>Attendance</Th>
            </tr>
          </thead>
          <tbody>
            {sort.sorted.map((p, i) => {
              const s = p.project;
              return (
                <tr
                  key={p.portalId}
                  onClick={() => onDrill(p.portalId)}
                  className="cursor-pointer animate-fade-in-up"
                  style={staggerStyle(Math.min(i, 12))}
                >
                  <td className="rounded-l-md px-2 py-1.5">
                    <span className="flex items-center gap-2">
                      <ColorDot color={p.color} />
                      <span className="truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.roster}</span>
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right font-mono text-xs tabular-nums",
                      (s.held === 0 || s.taken < s.held) && "text-warning",
                    )}
                  >
                    {s.taken}/{s.held}
                  </td>
                  <td className="px-2 py-1.5">
                    <MiniBar value={s.fillOut} warn={s.fillOut < LOW_FILL} />
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right font-mono text-xs tabular-nums",
                      s.attendance < AT_RISK_RATE && "text-warning",
                    )}
                  >
                    {s.attendance}%
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs text-muted-foreground">
                    {s.lastTaken ? fmtDate(s.lastTaken) : "Never"}
                    {s.lastTaken && s.untakenSinceLast > 0 && (
                      <span className="ml-1 text-warning">+{s.untakenSinceLast} unmarked</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <MiniBar value={p.gm.fillOut} warn={p.gm.fillOut < LOW_FILL} />
                  </td>
                  <td
                    className={cn(
                      "rounded-r-md px-2 py-1.5 text-right font-mono text-xs tabular-nums",
                      p.gm.attendance < AT_RISK_RATE && "text-warning",
                    )}
                  >
                    {p.gm.attendance}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---- at-risk -----------------------------------------------------------------

const AT_RISK_PREVIEW = 8;

function AtRiskSection({ members }: { members: MemberStat[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? members : members.slice(0, AT_RISK_PREVIEW);
  return (
    <Section
      title="At risk"
      count={members.length}
      index={2}
      hint={`Below ${AT_RISK_RATE}% attendance or ${AT_RISK_STREAK}+ absences in a row, for project meetings or GMs separately. Needs ${AT_RISK_MIN_MARKED}+ marks of that kind; unmarked meetings don't count.`}
    >
      <div className="flex flex-col divide-y divide-foreground/[0.06]">
        {shown.map((m) => (
          <div key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-sm">
            <PersonName userId={m.userId} name={m.name} />
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {m.projects.map((p) => (
                <span key={p.portalId} className="flex items-center gap-1">
                  <ColorDot color={p.color} />
                  {p.name}
                </span>
              ))}
            </span>
            <span className="ml-auto flex flex-wrap gap-1.5">
              {m.risk.map((r) => (
                <span key={r} className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                  {r}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      {members.length > AT_RISK_PREVIEW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="self-start text-xs text-muted-foreground hover:text-foreground"
        >
          {all ? "Show fewer" : `Show all ${members.length}`}
        </button>
      )}
    </Section>
  );
}

// ---- general meetings --------------------------------------------------------

function GmSection({ data }: { data: AttendanceAnalytics }) {
  const top = data.gmMisses.slice(0, 10);
  return (
    <Section
      title="General meetings"
      count={data.gms.length}
      index={3}
      hint="Club-wide events with attendance on, against every active member."
    >
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Legend cls="bg-success" label="Present" />
        <Legend cls="bg-warning" label="Excused" />
        <Legend cls="bg-destructive" label="Absent" />
        <Legend cls="bg-foreground/15" label="Unmarked" />
      </span>
      <div className="flex flex-col gap-2.5">
        {data.gms.map((e) => {
          const meta = isEventCategory(e.category) ? CATEGORY_META[e.category] : null;
          const total = Math.max(1, e.expected);
          const seg = [
            { n: e.counts.present, cls: "bg-success" },
            { n: e.counts.excused, cls: "bg-warning" },
            { n: e.counts.absent, cls: "bg-destructive" },
          ];
          return (
            <div key={e.id} className="flex items-center gap-3 text-sm">
              <span className="flex w-28 shrink-0 items-center gap-2 sm:w-56">
                <ColorDot color={meta?.color ?? null} />
                <span className="min-w-0 truncate">{e.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(e.start_time)}</span>
              </span>
              <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/15">
                {seg.map((s, j) => (
                  <span key={j} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
                ))}
              </span>
              <span className="shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums sm:w-44">
                {e.counts.present}/{e.expected}
                {e.unmarked > 0 && (
                  <span className="ml-1 hidden text-muted-foreground sm:inline">· {e.unmarked} unmarked</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {top.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">Most missed</h4>
          <div className="flex flex-col divide-y divide-foreground/[0.06]">
            {top.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-2 py-1.5 text-sm">
                <PersonName userId={m.userId} name={m.name} />
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                  <span className="text-destructive">{m.absent} absent</span>
                  {" · "}
                  {m.attended}/{data.gms.length} attended
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-sm", cls)} /> {label}
    </span>
  );
}

// ---- members -----------------------------------------------------------------

type MemberKey = "name" | "attendance" | "absent" | "streak" | "gmAttendance" | "gmAbsent" | "gmStreak";

function MembersSection({ members }: { members: MemberStat[] }) {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());

  const projectOptions = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; color: string | null }>();
    for (const m of members)
      for (const p of m.projects) seen.set(p.portalId, { key: p.portalId, label: p.name, color: p.color });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter(
      (m) =>
        (!q || m.name.toLowerCase().includes(q)) &&
        (projectFilter.size === 0 || m.projects.some((p) => projectFilter.has(p.portalId))),
    );
  }, [members, query, projectFilter]);

  const sort = useSort<MemberStat, MemberKey>(filtered, "attendance", "asc", {
    name: (m) => m.name,
    attendance: (m) => m.project.attendance,
    absent: (m) => m.project.counts.absent,
    streak: (m) => m.project.streak,
    gmAttendance: (m) => m.gm.attendance,
    gmAbsent: (m) => m.gm.counts.absent,
    gmStreak: (m) => m.gm.streak,
  });

  const { visible, pendingRows, sentinelRef } = useProgressiveList(sort.sorted, {
    resetKey: `${query}|${[...projectFilter].join(",")}|${sort.key}|${sort.dir}`,
  });

  return (
    <Section
      title="Members"
      count={filtered.length}
      index={4}
      hint="Only what was marked. A meeting nobody marked doesn't change a member's numbers. P / A / E = present / absent / excused."
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        <MultiSelectFilter
          label="Project"
          options={projectOptions}
          selected={projectFilter}
          onToggle={(k) =>
            setProjectFilter((s) => {
              const n = new Set(s);
              if (n.has(k)) n.delete(k);
              else n.add(k);
              return n;
            })
          }
          onClear={() => setProjectFilter(new Set())}
        />
      </div>
      <div className="-mx-1 overflow-x-auto">
        <table className="sheet-zebra w-full min-w-[46rem] text-sm">
          <thead>
            <tr>
              <GroupTh span={2} />
              <GroupTh span={3}>Project meetings</GroupTh>
              <GroupTh span={3}>General meetings</GroupTh>
            </tr>
            <tr className="text-left text-xs text-muted-foreground">
              <Th k="name" sort={sort}>Member</Th>
              <th className="px-2 py-1.5 font-medium">Projects</th>
              <Th k="attendance" sort={sort} right>Attendance</Th>
              <Th k="absent" sort={sort} right>P / A / E</Th>
              <Th k="streak" sort={sort} right>Streak</Th>
              <Th k="gmAttendance" sort={sort} right>Attendance</Th>
              <Th k="gmAbsent" sort={sort} right>P / A / E</Th>
              <Th k="gmStreak" sort={sort} right>Streak</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.userId}>
                <td className="whitespace-nowrap rounded-l-md px-2 py-1.5">
                  <PersonName userId={m.userId} name={m.name} />
                  {!m.active && <span className="ml-1.5 text-xs text-muted-foreground">inactive</span>}
                </td>
                <td className="max-w-[11rem] px-2 py-1.5">
                  <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                    {m.projects.length === 0
                      ? "—"
                      : m.projects.map((p) => (
                          <span key={p.portalId} className="flex items-center gap-1">
                            <ColorDot color={p.color} />
                            {p.name}
                          </span>
                        ))}
                  </span>
                </td>
                <RateCell value={m.project.attendance} />
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                  <Pae c={m.project.counts} />
                </td>
                <StreakCell value={m.project.streak} />
                <RateCell value={m.gm.attendance} />
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                  <Pae c={m.gm.counts} />
                </td>
                <StreakCell value={m.gm.streak} last />
              </tr>
            ))}
            {Array.from({ length: pendingRows }, (_, i) => (
              <tr key={`p${i}`} ref={sentinelRef} aria-hidden>
                <td colSpan={8} className="px-2 py-1.5">
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-3.5 w-32 rounded-full" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function RateCell({ value }: { value: number | null }) {
  return (
    <td
      className={cn(
        "px-2 py-1.5 text-right font-mono text-xs tabular-nums",
        value != null && value < AT_RISK_RATE && "text-warning",
      )}
    >
      {fmtPct(value)}
    </td>
  );
}

function StreakCell({ value, last }: { value: number; last?: boolean }) {
  return (
    <td
      className={cn(
        "px-2 py-1.5 text-right font-mono text-xs tabular-nums",
        last && "rounded-r-md",
        value >= AT_RISK_STREAK && "text-warning",
      )}
    >
      {value || "—"}
    </td>
  );
}

// ---- loading -----------------------------------------------------------------

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy>
      <div className="grid gap-4 sm:grid-cols-2">
        <HeadlineGroup title="Project meetings" s={null} fillHint="" />
        <HeadlineGroup title="General meetings" s={null} fillHint="" />
      </div>
      <SectionSkeleton title="Projects">
        <BarsSkeleton rows={8} />
      </SectionSkeleton>
      <SectionSkeleton title="Members">
        <BarsSkeleton rows={6} />
      </SectionSkeleton>
    </div>
  );
}
