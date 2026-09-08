"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal, RotateCcw, Mail, BarChart3, Table2, UserPlus, GripVertical, X, ArrowRight } from "lucide-react";
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useRoleSim } from "@/components/role-simulation-provider";
import { useDraftPicks, type PickRow } from "@/lib/use-draft-picks";
import { DraftWindowPanel } from "@/components/draft-panels";
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
import { EmailBlastDialog } from "@/components/email-blast-dialog";
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

// Drop target id for the wishlist zone on the left, under the roster.
const WISHLIST_DROPZONE_ID = "wishlist-dropzone";

// Name + status/indicator badges shared by the "left to review" row and the
// wishlist card — only the surrounding controls (drag handle vs. remove
// button) differ between the two.
function ApplicantMeta({ app, periodEndsAt }: { app: AppRow; periodEndsAt: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <PersonName userId={app.applicant?.user_id} name={applicantName(app)} className="text-sm font-medium truncate" />
      <StatusBadge status={app.status} />
      <LateBadge submittedAt={app.submitted_at} endsAt={periodEndsAt} />
      <ReturningIndicator returning={app.returning} />
      <CoffeeChatIndicator state={app.coffee} />
      <InfosessionIndicator attended={app.infosession} />
    </div>
  );
}

// One applicant in the "left to review" queue — draggable into the wishlist.
// Applicants already on the wishlist are excluded from this list entirely
// (they live on the left instead, so they're never shown/reviewable twice).
function ApplicantRow({
  app,
  periodEndsAt,
  onReview,
}: {
  app: AppRow;
  periodEndsAt: string | undefined;
  onReview: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: app.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-background ${isDragging ? "relative z-10 opacity-50 shadow-lg" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab touch-none shrink-0"
        aria-label="Drag to wishlist"
      >
        <GripVertical size={14} />
      </button>
      <ApplicantMeta app={app} periodEndsAt={periodEndsAt} />
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onReview}>
        Review
      </Button>
    </div>
  );
}

// A shortlisted applicant, shown only on the left — carries the Review
// action itself (rather than duplicating it on the right) plus a remove (×)
// to send them back to "Left to review". When a draft is active and this
// project has room in its upcoming round, also offers moving straight into
// the draft window below.
function WishlistCard({
  app,
  periodEndsAt,
  onReview,
  onRemove,
  onMoveToDraft,
}: {
  app: AppRow;
  periodEndsAt: string | undefined;
  onReview: () => void;
  onRemove: () => void;
  onMoveToDraft?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
      <ApplicantMeta app={app} periodEndsAt={periodEndsAt} />
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onReview}>
        Review
      </Button>
      {onMoveToDraft && (
        <button
          onClick={onMoveToDraft}
          className="text-muted-foreground/50 hover:text-foreground shrink-0"
          aria-label="Move to draft window"
          title="Move to draft window"
        >
          <ArrowRight size={15} />
        </button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
        onClick={onRemove}
        aria-label="Remove from wishlist"
      >
        <X size={14} />
      </Button>
    </div>
  );
}

// Drop zone under the roster — dragging an applicant card here shortlists them.
function WishlistDropzone({
  apps,
  periodEndsAt,
  onReview,
  onRemove,
  onMoveToDraft,
}: {
  apps: AppRow[];
  periodEndsAt: string | undefined;
  onReview: (app: AppRow) => void;
  onRemove: (id: string) => void;
  onMoveToDraft?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: WISHLIST_DROPZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-2 rounded-xl border-2 border-dashed p-3 min-h-[76px] transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
      }`}
    >
      {apps.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">Drag applicants here to shortlist them.</p>
      ) : (
        apps.map((a) => (
          <WishlistCard
            key={a.id}
            app={a}
            periodEndsAt={periodEndsAt}
            onReview={() => onReview(a)}
            onRemove={() => onRemove(a.id)}
            onMoveToDraft={onMoveToDraft ? () => onMoveToDraft(a.id) : undefined}
          />
        ))
      )}
    </div>
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
  const { isExec, canSimulate, persona } = useRoleSim();
  // VP Tech/President only (mirrors canEditWindow in manager/coffee-chats/page.tsx):
  // canSimulate is real-role VP Tech/President, persona==="exec" hides it while
  // previewing a lower "View as" persona.
  const canEmailBlast = canSimulate && persona === "exec";

  const [periods, setPeriods] = useState<ApplicationPeriod[] | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [periodsDialogOpen, setPeriodsDialogOpen] = useState(false);
  const [emailBlastOpen, setEmailBlastOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [projAnalyticsOpen, setProjAnalyticsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetReloadToken, setSheetReloadToken] = useState(0);
  const [appsReloadToken, setAppsReloadToken] = useState(0);
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
  // Application ids the current project's reviewers have shortlisted. null = loading.
  const [wishlistIds, setWishlistIds] = useState<Set<string> | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    setReviewableProjects(null);
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setReviewableProjects([]); return; }
      setCurrentUserId(user.id);

      const { data: roleRows } = await supabase
        .from("members_roles")
        .select("roles(role_name)")
        .eq("user_id", user.id);
      const roles = ((roleRows ?? []) as unknown as { roles: { role_name: string | null } | null }[])
        .flatMap((r) => (r.roles ? [r.roles] : []));
      // Real full-access role (VP Tech/President/VP Projects) — but "View as"
      // (canSimulate is real VP Tech/President) lets that reviewer preview a
      // lower persona, and the preview should behave like the real thing:
      // simulating PM/Member drops the org-wide scope down to whatever
      // projects they personally PM, same as an actual PM would see.
      const fullAccess = canReviewAllProjects(roles) && (!canSimulate || persona === "exec");
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
  }, [canSimulate, persona]);

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

  // Wishlist for the selected project (left column, under the roster).
  const loadWishlist = useCallback(async (projectId: string) => {
    const supabase = createClient();
    const { data } = await supabase.from("application_wishlist").select("application_id").eq("project_id", projectId);
    setWishlistIds(new Set((data ?? []).map((r: { application_id: string }) => r.application_id)));
  }, []);

  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) { setWishlistIds(null); return; }
    setWishlistIds(null);
    loadWishlist(selectedProjectId);
  }, [selectedProjectId, loadWishlist]);

  const addToWishlist = useCallback(async (applicationId: string) => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) return;
    setWishlistIds((prev) => new Set(prev).add(applicationId));
    const supabase = createClient();
    await supabase.from("application_wishlist").upsert(
      { application_id: applicationId, project_id: selectedProjectId, created_by: currentUserId },
      { onConflict: "application_id,project_id", ignoreDuplicates: true },
    );
  }, [selectedProjectId, currentUserId]);

  const removeFromWishlist = useCallback(async (applicationId: string) => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) return;
    setWishlistIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      next.delete(applicationId);
      return next;
    });
    const supabase = createClient();
    await supabase.from("application_wishlist").delete().eq("application_id", applicationId).eq("project_id", selectedProjectId);
  }, [selectedProjectId]);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    if (event.over?.id === WISHLIST_DROPZONE_ID) addToWishlist(String(event.active.id));
  }, [addToWishlist]);

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
  }, [selectedPeriodId, selectedProjectId, reviewableProjects, appsReloadToken]);

  // Period funnel stats track the period alone, so they survive the project
  // picker switching to "All projects".
  useEffect(() => {
    setStats(null);
    if (isExec && selectedPeriodId) loadStats(selectedPeriodId);
  }, [selectedPeriodId, isExec, loadStats]);

  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId) ?? null;
  const selectedProject = reviewableProjects?.find((p) => p.id === selectedProjectId) ?? null;

  const wishlistApps = apps && wishlistIds ? apps.filter((a) => wishlistIds.has(a.id)) : [];

  // Draft-round state for the selected project (Confirmed/Draft window,
  // shown below the Wishlist once a draft is active). Wishlisting itself
  // stays owned above (application_wishlist) -- this only tracks staging an
  // already-wishlisted applicant into the current round and submitting.
  const draftPicks = useDraftPicks(!allSelected ? selectedProjectId : null, selectedPeriodId);
  const nameById = new Map((apps ?? []).map((a) => [a.id, applicantName(a)]));

  const handleMoveToDraftWindow = async (applicationId: string) => {
    const ok = await draftPicks.moveToDraftWindow(applicationId);
    if (ok) removeFromWishlist(applicationId);
  };

  const handleMoveBackToWishlist = async (pick: PickRow) => {
    const ok = await draftPicks.moveBackToWishlist(pick);
    if (ok) addToWishlist(pick.application_id);
  };

  const handleSubmitDraftPicks = async () => {
    const ok = await draftPicks.submit();
    if (ok && selectedProjectId && !allSelected) {
      loadRoster(selectedProjectId);
      setAppsReloadToken((n) => n + 1);
    }
    return ok;
  };

  // Group applicants into rank sections (1st choice, 2nd choice, …) for the
  // currently selected project, most-preferred first. Wishlisted applicants
  // are excluded — they're shown (and reviewed) on the left instead, never
  // both places at once.
  const groupedApps = apps
    ? Object.entries(
        apps
          .filter((a) => !wishlistIds?.has(a.id))
          .reduce<Record<number, AppRow[]>>((acc, a) => {
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

        {canEmailBlast && selectedPeriod && (
          <Button variant="outline" size="sm" onClick={() => setEmailBlastOpen(true)}>
            <Mail size={14} className="mr-1.5" />
            Email blast
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
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setSheetOpen(true)} disabled={!selectedPeriodId}>
              <Table2 size={14} className="mr-1.5" />
              Open sheet view
            </Button>
            {fullAccessReview && (
              <Button asChild variant="outline" size="sm">
                <Link href="/manager/draft">
                  <UserPlus size={14} className="mr-1.5" />
                  Draft members
                </Link>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <DndContext sensors={dndSensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: who's already on the team, plus a shortlist you can drag
                applicants from the right into */}
            <div className="flex flex-col gap-6">
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

              <div className="flex flex-col gap-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Wishlist{wishlistIds ? ` (${wishlistApps.length})` : ""}
                </h2>
                <WishlistDropzone
                  apps={wishlistApps}
                  periodEndsAt={selectedPeriod?.ends_at}
                  onReview={(a) => setReviewFor({ id: a.id, name: applicantName(a), status: a.status })}
                  onRemove={removeFromWishlist}
                  onMoveToDraft={draftPicks.canAddToDraftWindow ? handleMoveToDraftWindow : undefined}
                />
              </div>

              {draftPicks.error && <p className="text-sm text-red-500">{draftPicks.error}</p>}

              {draftPicks.draftStarted && (
                <DraftWindowPanel
                  nameById={nameById}
                  nextRound={draftPicks.nextRound}
                  isMyTurn={draftPicks.isMyTurn}
                  draftWindowPicks={draftPicks.draftWindowPicks}
                  confirmedPicks={draftPicks.confirmedPicks}
                  onMoveBackToWishlist={handleMoveBackToWishlist}
                  onSubmit={handleSubmitDraftPicks}
                />
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
              ) : groupedApps.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
                  Everyone left to review is on your wishlist.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {groupedApps.map(([rank, list]) => (
                    <div key={rank} className="flex flex-col gap-1.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {rankLabel(rank)} ({list.length})
                      </h3>
                      {list.map((a) => (
                        <ApplicantRow
                          key={a.id}
                          app={a}
                          periodEndsAt={selectedPeriod?.ends_at}
                          onReview={() => setReviewFor({ id: a.id, name: applicantName(a), status: a.status })}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DndContext>
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
          canManageExtendedAccess={canEmailBlast}
        />
      )}

      {canEmailBlast && selectedPeriod && (
        <EmailBlastDialog
          open={emailBlastOpen}
          onOpenChange={setEmailBlastOpen}
          period={selectedPeriod}
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
