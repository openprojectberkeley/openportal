"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal, Mail, BarChart3, Table2, UserPlus } from "lucide-react";
import { DndContext, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useRoleSim } from "@/components/role-simulation-provider";
import { useDraftPicks } from "@/lib/use-draft-picks";
import { DraftWindowPanel, DRAFT_WINDOW_DROPZONE_ID } from "@/components/draft-panels";
import { DraggableApplicantCard, applicantName, type Applicant, type AppRow } from "@/components/applicant-meta";
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
import { type CoffeeState } from "@/components/applicant-indicators";

// The project currently under review: which project the reviewer is
// assigned to (or, for a full-access reviewer, has picked from all of them).
type ReviewableProject = { id: string; name: string };

// Sentinel for the cross-project mode in the project picker. A plain null still
// means "this reviewer has no projects", so it can't double as the sentinel.
const ALL_PROJECTS = "__all__";

// A current member of the selected project (left-hand roster column).
type RosterMember = { user_id: string; name: string; isPm: boolean };

function isOpenNow(p: ApplicationPeriod): boolean {
  const now = Date.now();
  return p.status === "open" && new Date(p.starts_at).getTime() <= now && now < new Date(p.ends_at).getTime();
}

function pickDefault(list: ApplicationPeriod[]): string | null {
  return list.find(isOpenNow)?.id ?? list[0]?.id ?? null;
}

// A readable ?project= value ("op-launch-website") instead of a raw uuid.
// Not guaranteed unique (two projects could share a name), but that's a
// cosmetic-only edge case here -- the first match wins, and the existing
// reviewableProjects check still keeps a reload from landing on a project
// this viewer can't actually access.
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Drop target id for the wishlist zone on the left, under the roster.
const WISHLIST_DROPZONE_ID = "wishlist-dropzone";
// Drop target id for the "Left to review" queue on the right -- dropping an
// applicant here sends them back to the plain review pool, out of the
// wishlist and/or draft window.
const LEFT_TO_REVIEW_DROPZONE_ID = "left-to-review-dropzone";

// Drop zone under the roster — dragging an applicant card here shortlists them.
function WishlistDropzone({
  apps,
  periodEndsAt,
  onReview,
  onRemove,
}: {
  apps: AppRow[];
  periodEndsAt: string | undefined;
  onReview: (app: AppRow) => void;
  onRemove: (id: string) => void;
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
          <DraggableApplicantCard
            key={a.id}
            app={a}
            periodEndsAt={periodEndsAt}
            onReview={() => onReview(a)}
            onRemove={() => onRemove(a.id)}
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ready: roleSimReady, isExec, canSimulate, persona } = useRoleSim();
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
  const { setNodeRef: setReviewZoneRef, isOver: isOverReviewZone } = useDroppable({ id: LEFT_TO_REVIEW_DROPZONE_ID });

  useEffect(() => {
    // Wait for the role-simulation provider's own async load: canSimulate/
    // persona start at their no-access defaults (false/"member") until then,
    // so fetching against them first would compute the wrong reviewable-
    // projects scope -- and since the URL's ?project= slug is only resolved
    // against the first non-null list (below), that wrong list would burn
    // the one shot before the correct, "ready" list ever loads.
    if (!roleSimReady) return;
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
  }, [roleSimReady, canSimulate, persona]);

  useEffect(() => {
    setSelectedProjectId((cur) => {
      if (!reviewableProjects) return cur;
      if (cur === ALL_PROJECTS) return fullAccessReview ? cur : null;
      if (cur && reviewableProjects.some((p) => p.id === cur)) return cur;

      // No valid selection yet -- try the live ?project= slug from the URL
      // before falling back to the default, so a reload lands back on the
      // same project. Reading searchParams directly (not a one-shot ref
      // frozen at mount) means this keeps re-trying with whatever the URL
      // actually says on every relevant render, instead of being able to
      // silently lose the attempt to a render-timing fluke; once `cur`
      // above is valid it short-circuits before reaching here, so this
      // never fights a later click from the user.
      const slug = searchParams.get("project");
      if (slug === "all") {
        if (fullAccessReview) return ALL_PROJECTS;
      } else if (slug) {
        const match = reviewableProjects.find((p) => slugify(p.name) === slug);
        if (match) return match.id;
      }

      // Full-access reviewers land on the cross-project view; PMs land on a project.
      if (fullAccessReview) return ALL_PROJECTS;
      return reviewableProjects[0]?.id ?? null;
    });
  }, [reviewableProjects, fullAccessReview, searchParams]);

  // Keeps ?project= (a readable name slug, not the raw id) in sync so a
  // reload or a shared link lands back on the same project/"All projects".
  useEffect(() => {
    if (!selectedProjectId) return;
    const param = selectedProjectId === ALL_PROJECTS
      ? "all"
      : slugify(reviewableProjects?.find((p) => p.id === selectedProjectId)?.name ?? "");
    if (!param || searchParams.get("project") === param) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", param);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [selectedProjectId, reviewableProjects, pathname, router, searchParams]);

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

  // Draft-round state for the selected project (Confirmed/Draft window,
  // shown once a draft is active). Independent of the wishlist -- an
  // applicant can be dragged into the draft window from "Left to review" or
  // the wishlist, and dragged back out to either, directly.
  const draftPicks = useDraftPicks(!allSelected ? selectedProjectId : null, selectedPeriodId);

  const handleSubmitDraftPicks = async () => {
    const ok = await draftPicks.submit();
    if (ok && selectedProjectId && !allSelected) {
      loadRoster(selectedProjectId);
      setAppsReloadToken((n) => n + 1);
    }
    return ok;
  };

  // Three peer drop zones (Wishlist, Draft window, Left to review) any
  // applicant card can move between directly -- whichever zone it lands on
  // becomes its new home, and it's removed from the other two (harmless
  // no-op if it wasn't in them).
  const onDragEnd = useCallback((event: DragEndEvent) => {
    const id = String(event.active.id);
    const overId = event.over?.id;
    if (overId === WISHLIST_DROPZONE_ID) {
      addToWishlist(id);
      draftPicks.removeFromDraftWindow(id);
    } else if (overId === DRAFT_WINDOW_DROPZONE_ID) {
      draftPicks.addToDraftWindow(id);
      removeFromWishlist(id);
    } else if (overId === LEFT_TO_REVIEW_DROPZONE_ID) {
      removeFromWishlist(id);
      draftPicks.removeFromDraftWindow(id);
    }
  }, [addToWishlist, removeFromWishlist, draftPicks]);

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

  // Applicants currently staged in the draft window or already confirmed
  // this draft -- excluded from the wishlist and "Left to review" pools so
  // an applicant is never shown (or draggable) in two places at once.
  const draftedIds = new Set([
    ...draftPicks.draftWindowPicks.map((p) => p.application_id),
    ...draftPicks.confirmedPicks.map((p) => p.application_id),
  ]);

  const wishlistApps = apps && wishlistIds ? apps.filter((a) => wishlistIds.has(a.id) && !draftedIds.has(a.id)) : [];
  const appById = new Map((apps ?? []).map((a) => [a.id, a]));

  // Group applicants into rank sections (1st choice, 2nd choice, …) for the
  // currently selected project, most-preferred first. Wishlisted and
  // drafted applicants are excluded — they're shown (and reviewed) on the
  // left instead, never both places at once.
  const groupedApps = apps
    ? Object.entries(
        apps
          .filter((a) => !wishlistIds?.has(a.id) && !draftedIds.has(a.id))
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
                />
              </div>

              {draftPicks.error && <p className="text-sm text-red-500">{draftPicks.error}</p>}

              {draftPicks.draftStarted && (
                <DraftWindowPanel
                  appById={appById}
                  periodEndsAt={selectedPeriod?.ends_at}
                  onReview={(a) => setReviewFor({ id: a.id, name: applicantName(a), status: a.status })}
                  nextRound={draftPicks.nextRound}
                  isMyTurn={draftPicks.isMyTurn}
                  draftWindowPicks={draftPicks.draftWindowPicks}
                  confirmedPicks={draftPicks.confirmedPicks}
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
              <div
                ref={setReviewZoneRef}
                className={`flex flex-col gap-3 rounded-xl transition-colors ${isOverReviewZone ? "ring-2 ring-primary ring-offset-1" : ""}`}
              >
                {apps === null ? (
                  <ApplicationListSkeleton rows={4} />
                ) : apps.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
                    No submitted applications for this project yet.
                  </div>
                ) : groupedApps.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground border-2 border-dashed rounded-xl">
                    Everyone left to review is on your wishlist or in the draft window.
                  </div>
                ) : (
                  groupedApps.map(([rank, list]) => (
                    <div key={rank} className="flex flex-col gap-1.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {rankLabel(rank)} ({list.length})
                      </h3>
                      {list.map((a) => (
                        <DraggableApplicantCard
                          key={a.id}
                          app={a}
                          periodEndsAt={selectedPeriod?.ends_at}
                          onReview={() => setReviewFor({ id: a.id, name: applicantName(a), status: a.status })}
                        />
                      ))}
                    </div>
                  ))
                )}
              </div>
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
