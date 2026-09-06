"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal, RotateCcw, BarChart3, Table2 } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";
import { PersonName } from "@/components/person-profile-provider";
import { canReviewAllProjects } from "@/lib/roles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApplicationListSkeleton } from "@/components/skeletons";
import { ApplicationPeriodsDialog, type ApplicationPeriod } from "@/components/application-periods-dialog";
import {
  ApplicationReviewModal,
  type FocusSection,
  type ReviewStatus,
} from "@/components/application-review-modal";
import { ApplicationStats, type Stats } from "@/components/application-stats";
import { ApplicationAnalyticsModal } from "@/components/application-analytics-modal";
import { ApplicationSheetModal } from "@/components/application-sheet-modal";
import { ProjectAnalyticsModal } from "@/components/project-analytics-modal";
import { rankLabel } from "@/lib/application-rank";
import { CoffeeChatIndicator, InfosessionIndicator, LateBadge, type CoffeeState } from "@/components/applicant-indicators";

type Applicant = { user_id: string; preferred_firstname: string | null; lastname: string | null };

// The project currently under review: which project the reviewer is
// assigned to (or, for a full-access reviewer, has picked from all of them).
type ReviewableProject = { id: string; name: string };

// Sentinel for the cross-project mode in the project picker. A plain null still
// means "this reviewer has no projects", so it can't double as the sentinel.
const ALL_PROJECTS = "__all__";

// A current member of the selected project (left-hand roster column).
type RosterMember = { user_id: string; name: string; isPm: boolean };

type AppRow = {
  id: string;
  status: ReviewStatus;
  submitted_at: string | null;
  applicant: Applicant | null;
  coffee: CoffeeState;
  // Applicant was a member before (status active/inactive) vs. a first-timer.
  returning: boolean;
  // This applicant's rank (1-7) for the currently selected project.
  rank: number;
  // Applicant checked in to at least one info session.
  infosession: boolean;
};

function isOpenNow(p: ApplicationPeriod): boolean {
  const now = Date.now();
  return p.status === "open" && new Date(p.starts_at).getTime() <= now && now < new Date(p.ends_at).getTime();
}

function pickDefault(list: ApplicationPeriod[]): string | null {
  return list.find(isOpenNow)?.id ?? list[0]?.id ?? null;
}

function applicantName(a: AppRow): string {
  return [a.applicant?.preferred_firstname, a.applicant?.lastname].filter(Boolean).join(" ") || "Applicant";
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "accepted") return <Badge className="bg-green-600 hover:bg-green-600">Accepted</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return null;
}

// Small badge marking an applicant who was a member in a previous semester.
function ReturningIndicator({ returning }: { returning: boolean }) {
  if (!returning) return null;
  return (
    <Badge variant="outline" className="gap-1 border-transparent text-indigo-600" title="Returning member">
      <RotateCcw size={11} />
      Returning
    </Badge>
  );
}

function PeriodStatusText({ period }: { period: ApplicationPeriod }) {
  const label = isOpenNow(period)
    ? "Open now"
    : period.status === "open"
      ? "Open (outside window)"
      : period.status === "closed"
        ? "Closed"
        : "Draft";
  const color = isOpenNow(period) ? "text-green-600" : "text-muted-foreground";
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

export default function ManagerApplicationsPage() {
  const { isExec } = useRoleSim();

  const [periods, setPeriods] = useState<ApplicationPeriod[] | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [periodsDialogOpen, setPeriodsDialogOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [projAnalyticsOpen, setProjAnalyticsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetReloadToken, setSheetReloadToken] = useState(0);
  const [reviewFor, setReviewFor] = useState<
    { id: string; name: string; status: ReviewStatus; projectId?: string | null; focus?: FocusSection } | null
  >(null);

  // Which project(s) the current viewer may review: every project if they hold
  // a full-access role (VP Tech/President/VP Projects), otherwise only the
  // ones they PM. null = still loading.
  const [reviewableProjects, setReviewableProjects] = useState<ReviewableProject[] | null>(null);
  const [fullAccessReview, setFullAccessReview] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const allSelected = selectedProjectId === ALL_PROJECTS;
  // Everyone currently on the selected project (left column). null = loading.
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [allCounts, setAllCounts] = useState<{ applicants: number; projects: number } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setReviewableProjects([]); return; }

      const { data: roleRows } = await supabase
        .from("members_roles")
        .select("roles(role_name)")
        .eq("user_id", user.id);
      const roles = ((roleRows ?? []) as unknown as { roles: { role_name: string | null } | null }[])
        .flatMap((r) => (r.roles ? [r.roles] : []));
      const fullAccess = canReviewAllProjects(roles);
      setFullAccessReview(fullAccess);

      if (fullAccess) {
        const { data } = await supabase.from("projects").select("id, name").order("name");
        setReviewableProjects((data ?? []) as ReviewableProject[]);
      } else {
        const { data } = await supabase
          .from("project_members")
          .select("project_id, projects(name)")
          .eq("user_id", user.id)
          .eq("is_pm", true);
        const list = ((data ?? []) as unknown as { project_id: string; projects: { name: string } | null }[])
          .map((r) => ({ id: r.project_id, name: r.projects?.name ?? "Untitled project" }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setReviewableProjects(list);
      }
    })();
  }, []);

  useEffect(() => {
    setSelectedProjectId((cur) => {
      if (!reviewableProjects) return cur;
      if (cur === ALL_PROJECTS) return fullAccessReview ? cur : null;
      if (cur && reviewableProjects.some((p) => p.id === cur)) return cur;
      // Full-access reviewers land on the cross-project view; PMs land on a project.
      if (fullAccessReview) return ALL_PROJECTS;
      return reviewableProjects[0]?.id ?? null;
    });
  }, [reviewableProjects, fullAccessReview]);

  // Roster of the selected project (left column) — who's already on the team.
  const loadRoster = useCallback(async (projectId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("project_members")
      .select("user_id, is_pm, members(user_id, preferred_firstname, lastname)")
      .eq("project_id", projectId);
    const list = ((data ?? []) as unknown as { user_id: string; is_pm: boolean; members: Applicant | null }[])
      .map((r) => ({
        user_id: r.user_id,
        name: [r.members?.preferred_firstname, r.members?.lastname].filter(Boolean).join(" ") || "Member",
        isPm: r.is_pm,
      }))
      .sort((a, b) => (a.isPm !== b.isPm ? (a.isPm ? -1 : 1) : a.name.localeCompare(b.name)));
    setRoster(list);
  }, []);

  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) { setRoster(null); return; }
    setRoster(null);
    loadRoster(selectedProjectId);
  }, [selectedProjectId, loadRoster]);

  // Headline numbers for the cross-project view, which has no per-project list.
  useEffect(() => {
    if (!allSelected || !selectedPeriodId) { setAllCounts(null); return; }
    setAllCounts(null);
    const supabase = createClient();
    (async () => {
      const [{ count: applicants }, { count: projects }] = await Promise.all([
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("period_id", selectedPeriodId)
          .in("status", ["submitted", "accepted", "rejected"]),
        supabase.from("projects").select("id", { count: "exact", head: true }),
      ]);
      setAllCounts({ applicants: applicants ?? 0, projects: projects ?? 0 });
    })();
  }, [allSelected, selectedPeriodId]);

  // Exec-only period funnel stats, shown above the list.
  const loadStats = useCallback(async (periodId: string) => {
    const supabase = createClient();
    const { data } = await supabase.rpc("application_period_stats", { p_period_id: periodId });
    setStats((data?.[0] as Stats) ?? null);
  }, []);

  const loadPeriods = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("application_periods")
      .select("id, name, starts_at, ends_at, status")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as ApplicationPeriod[];
    setPeriods(list);
    setSelectedPeriodId((cur) => (cur && list.some((p) => p.id === cur) ? cur : pickDefault(list)));
  }, []);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  useEffect(() => {
    if (!selectedPeriodId) { setApps([]); return; }
    if (!reviewableProjects) { setApps(null); return; } // still loading review scope
    // No assigned projects to review, or the cross-project view (sheet-only).
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) { setApps([]); return; }
    const supabase = createClient();
    setApps(null);
    // applicant_id is the auth user id (no FK to `members`), so fetch the rows
    // first, then resolve names in a second pass keyed on members.user_id.
    // `application_rankings!inner(...)` + the two `.eq` filters below turn the
    // embed into an inner join, so only applicants who ranked the selected
    // project come back, each carrying their rank for that project.
    (async () => {
      const { data } = await supabase
        .from("applications")
        .select(
          `id, status, submitted_at, applicant_id,
           application_rankings!inner(rank)`,
        )
        .eq("period_id", selectedPeriodId)
        .in("status", ["submitted", "accepted", "rejected"])
        .eq("application_rankings.project_id", selectedProjectId)
        .eq("application_rankings.ranked", true)
        .order("submitted_at", { ascending: true });

      const rows = ((data ?? []) as unknown as { id: string; status: ReviewStatus; submitted_at: string | null; applicant_id: string | null; application_rankings: { rank: number }[] }[])
        .map(({ application_rankings, ...r }) => ({ ...r, rank: application_rankings[0]?.rank ?? 0 }));
      const ids = [...new Set(rows.map((r) => r.applicant_id).filter((id): id is string => !!id))];
      const byId: Record<string, Applicant> = {};
      const returningById: Record<string, boolean> = {};
      const coffeeById: Record<string, CoffeeState> = {};
      const attendedInfo = new Set<string>();
      if (ids.length) {
        const idSet = new Set(ids);
        const [{ data: mem }, { data: chats }, { data: info }] = await Promise.all([
          supabase.from("members").select("user_id, preferred_firstname, lastname, status").in("user_id", ids),
          // A booked chat has applicant_id set; `complete` marks it done. Open
          // (unbooked) slots have a null applicant_id and won't match.
          supabase.from("coffee_chats").select("applicant_id, complete").in("applicant_id", ids),
          // Attendance is recorded under member_id or applicant_id depending on
          // whether they were a member at the time; both are auth user ids.
          supabase
            .from("infosesh_attendance")
            .select("applicant_id, member_id")
            .or(`applicant_id.in.(${ids.join(",")}),member_id.in.(${ids.join(",")})`),
        ]);
        for (const m of (mem ?? []) as (Applicant & { status: string | null })[]) {
          byId[m.user_id] = m;
          // A past member (active or rolled-off) is "returning"; mirrors is_returning_member().
          returningById[m.user_id] = m.status === "active" || m.status === "inactive";
        }
        for (const ch of (chats ?? []) as { applicant_id: string; complete: boolean }[]) {
          if (ch.complete) coffeeById[ch.applicant_id] = "done";
          else if (coffeeById[ch.applicant_id] !== "done") coffeeById[ch.applicant_id] = "booked";
        }
        for (const r of (info ?? []) as { applicant_id: string | null; member_id: string | null }[]) {
          if (r.applicant_id && idSet.has(r.applicant_id)) attendedInfo.add(r.applicant_id);
          if (r.member_id && idSet.has(r.member_id)) attendedInfo.add(r.member_id);
        }
      }

      setApps(
        rows.map(({ applicant_id, ...r }) => ({
          ...r,
          applicant: applicant_id
            ? byId[applicant_id] ?? { user_id: applicant_id, preferred_firstname: null, lastname: null }
            : null,
          coffee: (applicant_id && coffeeById[applicant_id]) || "none",
          returning: !!applicant_id && !!returningById[applicant_id],
          infosession: !!applicant_id && attendedInfo.has(applicant_id),
        })),
      );
    })();
  }, [selectedPeriodId, selectedProjectId, reviewableProjects]);

  // Period funnel stats track the period alone, so they survive the project
  // picker switching to "All projects".
  useEffect(() => {
    setStats(null);
    if (isExec && selectedPeriodId) loadStats(selectedPeriodId);
  }, [selectedPeriodId, isExec, loadStats]);

  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId) ?? null;
  const selectedProject = reviewableProjects?.find((p) => p.id === selectedProjectId) ?? null;

  // Group applicants into rank sections (1st choice, 2nd choice, …) for the
  // currently selected project, most-preferred first.
  const groupedApps = apps
    ? Object.entries(
        apps.reduce<Record<number, AppRow[]>>((acc, a) => {
          (acc[a.rank] ??= []).push(a);
          return acc;
        }, {}),
      )
        .map(([rank, list]) => [Number(rank), list] as [number, AppRow[]])
        .sort((x, y) => x[0] - y[0])
    : [];

  const onReviewed = (id: string, status: ReviewStatus) => {
    setApps((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, status } : a)) : prev));
    if (isExec && selectedPeriodId) loadStats(selectedPeriodId);
    // Accepting adds the applicant to project_members — refresh the roster so
    // they show up on the left without a full page reload.
    if (status === "accepted" && selectedProjectId && !allSelected) loadRoster(selectedProjectId);
    if (sheetOpen) setSheetReloadToken((n) => n + 1);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/manager" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Applications</h1>
        <p className="text-sm text-muted-foreground">
          Review submitted applications and accept applicants into a project. Tip: use
          &ldquo;View as&rdquo; (bottom-right) to preview the accepted-member experience.
        </p>
      </div>

      {/* Period bar */}
      <div className="flex flex-wrap items-center gap-3">
        {periods === null ? (
          <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
        ) : periods.length === 0 ? (
          <span className="text-sm text-muted-foreground">No application periods yet.</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                <span className="font-medium">{selectedPeriod?.name ?? "Select period"}</span>
                {selectedPeriod && <PeriodStatusText period={selectedPeriod} />}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {periods.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setSelectedPeriodId(p.id)} className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <PeriodStatusText period={p} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isExec && (
          <Button variant="outline" size="sm" onClick={() => setPeriodsDialogOpen(true)}>
            <SlidersHorizontal size={14} className="mr-1.5" />
            Manage periods
          </Button>
        )}

        {isExec && selectedPeriodId && (
          <Button variant="outline" size="sm" onClick={() => setAnalyticsOpen(true)}>
            <BarChart3 size={14} className="mr-1.5" />
            View analytics
          </Button>
        )}
      </div>

      {/* Exec-only period funnel stats */}
      {isExec && selectedPeriodId && <ApplicationStats stats={stats} />}

      {/* Project bar: which project's applicants you're reviewing — sits right
          above the split view so it reads as a header for the applicant lists. */}
      {reviewableProjects !== null && reviewableProjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {reviewableProjects.length === 1 && !fullAccessReview ? (
            <span className="text-sm text-muted-foreground">
              Reviewing for <span className="font-medium text-foreground">{reviewableProjects[0].name}</span>
            </span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 self-start border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                  <span className="text-muted-foreground">Reviewing for</span>
                  <span className="font-medium">
                    {allSelected ? "All projects" : selectedProject?.name ?? "Select project"}
                  </span>
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {fullAccessReview && (
                  <>
                    <DropdownMenuItem onSelect={() => setSelectedProjectId(ALL_PROJECTS)}>
                      All projects
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {reviewableProjects.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => setSelectedProjectId(p.id)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isExec && selectedPeriodId && (
            <Button variant="outline" size="sm" onClick={() => setProjAnalyticsOpen(true)}>
              <BarChart3 size={14} className="mr-1.5" />
              Project analytics
            </Button>
          )}
        </div>
      )}
      {reviewableProjects === null && <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />}

      {isExec && (
        <ProjectAnalyticsModal
          open={projAnalyticsOpen}
          onOpenChange={setProjAnalyticsOpen}
          periodId={selectedPeriodId}
          periodName={selectedPeriod?.name}
        />
      )}

      {isExec && (
        <ApplicationAnalyticsModal
          open={analyticsOpen}
          onOpenChange={setAnalyticsOpen}
          periods={periods ?? []}
          initialPeriodId={selectedPeriodId}
        />
      )}

      {/* Split view: current team on the left, applicants left to review
          (grouped by rank: 1st choice, 2nd choice, …) on the right */}
      {reviewableProjects?.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
          You aren&apos;t assigned to review any projects.
        </div>
      ) : allSelected ? (
        // Cross-project mode has no single roster or rank grouping to show, so
        // the page hands off to the sheet.
        <div className="flex flex-col items-center gap-3 border rounded-xl px-4 py-12 text-center">
          <p className="text-sm font-medium">Reviewing every project this period</p>
          <p className="text-sm text-muted-foreground">
            {allCounts
              ? `${allCounts.applicants} application${allCounts.applicants === 1 ? "" : "s"} across ${allCounts.projects} project${allCounts.projects === 1 ? "" : "s"}.`
              : "Loading counts…"}{" "}
            Open the sheet to page through one project at a time.
          </p>
          <Button size="sm" onClick={() => setSheetOpen(true)} disabled={!selectedPeriodId}>
            <Table2 size={14} className="mr-1.5" />
            Open sheet view
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: who's already on the team */}
          <div className="flex flex-col gap-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              On the team{roster ? ` (${roster.length})` : ""}
            </h2>
            {roster === null ? (
              <ApplicationListSkeleton rows={3} />
            ) : roster.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
                No one on this project yet.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {roster.map((m) => (
                  <div key={m.user_id} className="flex items-center gap-2 border rounded-xl px-4 py-3">
                    <PersonName userId={m.user_id} name={m.name} className="text-sm font-medium" />
                    {m.isPm && <Badge variant="outline">PM</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: applicants left to pick from */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Left to review
              </h2>
              {selectedPeriodId && selectedProjectId && (
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setSheetOpen(true)}>
                  <Table2 size={13} className="mr-1.5" />
                  Sheet view
                </Button>
              )}
            </div>
            {apps === null ? (
              <ApplicationListSkeleton rows={4} />
            ) : apps.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
                No submitted applications for this project yet.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {groupedApps.map(([rank, list]) => (
                  <div key={rank} className="flex flex-col gap-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {rankLabel(rank)} ({list.length})
                    </h3>
                    {list.map((a) => {
                      const name = applicantName(a);
                      return (
                        <div key={a.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <PersonName userId={a.applicant?.user_id} name={name} className="text-sm font-medium truncate" />
                            <StatusBadge status={a.status} />
                            <LateBadge submittedAt={a.submitted_at} endsAt={selectedPeriod?.ends_at} />
                            <ReturningIndicator returning={a.returning} />
                            <CoffeeChatIndicator state={a.coffee} />
                            <InfosessionIndicator attended={a.infosession} />
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => setReviewFor({ id: a.id, name, status: a.status })}
                          >
                            Review
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ApplicationSheetModal
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        periodId={selectedPeriodId}
        periodName={selectedPeriod?.name}
        periodEndsAt={selectedPeriod?.ends_at}
        projectId={allSelected ? null : selectedProjectId}
        projectName={selectedProject?.name}
        allProjects={allSelected}
        onReview={(row) => setReviewFor(row)}
        reloadToken={sheetReloadToken}
      />

      {isExec && periods && (
        <ApplicationPeriodsDialog
          open={periodsDialogOpen}
          onOpenChange={setPeriodsDialogOpen}
          periods={periods}
          onChanged={loadPeriods}
        />
      )}

      {reviewFor && (
        <ApplicationReviewModal
          applicationId={reviewFor.id}
          applicantName={reviewFor.name}
          status={reviewFor.status}
          contextProjectId={reviewFor.projectId ?? (allSelected ? null : selectedProjectId)}
          focus={reviewFor.focus}
          open={!!reviewFor}
          onOpenChange={(o) => { if (!o) setReviewFor(null); }}
          onReviewed={(status) => onReviewed(reviewFor.id, status)}
        />
      )}
    </div>
  );
}
