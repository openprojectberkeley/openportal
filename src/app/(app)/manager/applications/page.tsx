"use client";

import { createClient } from "@/lib/supabase/client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, Mail, BarChart3, Table2 } from "lucide-react";
import { flipMove } from "@/lib/flip-move";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useRoleSim } from "@/components/role-simulation-provider";
import { useDraftPicks } from "@/lib/use-draft-picks";
import { DraftWindowPanel, DRAFT_WINDOW_DROPZONE_ID } from "@/components/draft-panels";
import {
  SortableApplicantCard,
  StaticApplicantCard,
  applicantName,
  type Applicant,
  type AppRow,
} from "@/components/applicant-meta";
import { PersonName } from "@/components/person-profile-provider";
import { canReviewAllProjects } from "@/lib/roles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApplicationListSkeleton } from "@/components/skeletons";
import { ApplicationPeriodsDialog, type ApplicationPeriod } from "@/components/application-periods-dialog";
import { EmailBlastDialog } from "@/components/email-blast-dialog";
import {
  ApplicationReviewModal,
  type FocusSection,
  type RecruitingFacts,
  type ReviewStatus,
} from "@/components/application-review-modal";
import { ApplicationStats, type Stats } from "@/components/application-stats";
import { AnalyticsModal } from "@/components/analytics-modal";
import { ApplicationSheetModal } from "@/components/application-sheet-modal";
import { AllProjectsBoard } from "@/components/all-projects-board";
import { enrichAppRows } from "@/lib/applicant-rows";
import { rankLabel } from "@/lib/application-rank";
import { compareReviewPriority } from "@/lib/utils";
import { DEFAULT_ACCENT } from "@/lib/portal-color";
import { staggerStyle } from "@/lib/motion";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { BackLink } from "@/components/back-link";
import { AdminCrown } from "@/components/admin-crown";
import { InfoHint } from "@/components/ui/info-hint";
import { Search } from "lucide-react";
import { isLate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter } from "@/components/multi-select-filter";

// The project currently under review: which project the reviewer is
// assigned to (or, for a full-access reviewer, has picked from all of them).
type ReviewableProject = { id: string; name: string; color: string | null };

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

// The two zones the DnD moves applicants between -- the same multi-container
// sortable arrangement as the applicant ranking page's RANKED_ZONE /
// AVAILABLE_ZONE (see app/(app)/application/page.tsx). The wishlist plays
// "your ranking" (hand-ordered), the choice groups play "available projects"
// (order derived, never hand-sorted, but membership changes live).
//
// Card ids are the raw application id, with no per-zone prefix: an applicant is
// in exactly one of the two lists at a time, so which zone a card is in is a
// membership test against the live wishlist array rather than a prefix. That
// also means a card re-parents between the two SortableContexts mid-drag
// instead of unmounting -- which is what keeps dnd-kit's active node alive.
const WISHLIST_DROPZONE_ID = "wishlist-dropzone";
const APPLICANTS_ZONE_ID = "applicants-zone";

// Filters for the single-project applicant lists (each selected one must hold).
const APP_FILTERS = [
  { key: "meets", label: "Meets requirements" },
  { key: "missing", label: "Missing requirements" },
  { key: "returning", label: "Returning" },
  { key: "first", label: "First-time" },
  { key: "late", label: "Submitted late" },
  { key: "wishlisted", label: "Wishlisted by other projects" },
  { key: "available", label: "Not taken by another project" },
];

const recruitingOf = (a: AppRow): RecruitingFacts => ({
  coffee: a.coffee,
  coffeeWith: a.coffeeWith,
  returning: a.returning,
  infosession: a.infosession,
});

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// The wishlist at the top of the Applicants column -- the manager-side twin of
// the ranking page's RankZone. A drop target plus a SortableContext, so a card
// can be dragged in from the choice groups below and dropped into any slot
// (first or last included), or reordered in place. An applicant here is no
// longer listed below, so each card carries a quiet ordinal standing in for the
// choice heading it left.
function WishlistDropzone({
  apps,
  periodEndsAt,
  draftActive,
  addToDraftDisabled,
  cardDraftState,
  onReview,
  onWishlistToggle,
  onAddToDraft,
}: {
  apps: AppRow[];
  periodEndsAt: string | undefined;
  draftActive: boolean;
  addToDraftDisabled: (id: string) => boolean;
  // How this applicant's draft state paints their card -- same per-id-callback
  // shape as addToDraftDisabled above.
  cardDraftState: (id: string) => { staged?: boolean; claimedBy?: string };
  onReview: (app: AppRow) => void;
  onWishlistToggle: (id: string) => void;
  onAddToDraft: (id: string) => void;
}) {
  // The droppable ref sits on the outer div, so an empty wishlist is still a
  // valid drop target even though the SortableContext below is unmounted.
  const { setNodeRef } = useDroppable({ id: WISHLIST_DROPZONE_ID });
  return (
    <div ref={setNodeRef} className="min-h-24 flex flex-col divide-y divide-foreground/[0.06]">
      {apps.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground py-8 rounded-lg bg-foreground/[0.03]">
          Drag applicants here to shortlist them
        </div>
      ) : (
        <SortableContext items={apps.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          {apps.map((a) => (
            <SortableApplicantCard
              key={a.id}
              app={a}
              {...cardDraftState(a.id)}
              periodEndsAt={periodEndsAt}
              isWishlisted
              onReview={onReview}
              onWishlistToggle={onWishlistToggle}
              showAddToDraft={draftActive}
              onAddToDraft={onAddToDraft}
              addToDraftDisabled={addToDraftDisabled(a.id)}
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

// The choice-grouped Applicants list -- the manager-side twin of the ranking
// page's AvailableZone. A droppable (so a wishlist card can be dragged back down
// here to un-shortlist it, even when the list is empty) wrapping one
// SortableContext that spans every rank group in render order; the group
// headings sit inside it as non-sortable siblings, which is harmless since only
// ids in `items` participate. The groups themselves are never hand-sorted --
// their order is always derived from compareReviewPriority.
function ApplicantsZone({ items, children }: { items: string[]; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: APPLICANTS_ZONE_ID });
  return (
    <div ref={setNodeRef} className="flex flex-col gap-3 rounded-xl">
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
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
  const color = isOpenNow(period) ? "text-success" : "text-muted-foreground";
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

export default function ManagerApplicationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ready: roleSimReady, isExec, isBoardOrExec, canSimulate, persona } = useRoleSim();
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetReloadToken, setSheetReloadToken] = useState(0);
  // Coffee / infosession badges on applicant cards — off by default for denser drafting.
  // Bumped when sheet recruiting edits change coffee/info/returning so the
  // card list reloads the same derived flags.
  const [appsReloadToken, setAppsReloadToken] = useState(0);
  const [appQuery, setAppQuery] = useState("");
  const [appFilters, setAppFilters] = useState<Set<string>>(new Set());
  const [reviewFor, setReviewFor] = useState<
    { id: string; name: string; status: ReviewStatus; projectId?: string | null; focus?: FocusSection; recruiting?: RecruitingFacts } | null
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
  // Bumped when a review changes something the cross-project board shows
  // (accepting someone puts them on a roster), so it refetches.
  const [boardReloadToken, setBoardReloadToken] = useState(0);
  // Application ids the current project's reviewers have shortlisted, in the
  // PM's chosen order (persisted via application_wishlist.position). null = loading.
  const [wishlist, setWishlist] = useState<string[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Drives the one-shot accent sweep on a newly confirmed pick (see below).

  // Live drag state: the id of the card being dragged (namespaced), and a
  // working copy of `wishlist` mutated on hover so the list reflows under the
  // pointer -- committed to `wishlist` (and the DB) on drop. Mirrors the
  // application ranking page's dragRanked.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragWishlist, setDragWishlist] = useState<string[] | null>(null);
  const dragWishlistRef = useRef<string[] | null>(null);
  const setDragWishlistLive = (next: string[] | null) => {
    dragWishlistRef.current = next;
    setDragWishlist(next);
  };

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
        const { data } = await supabase.from("projects").select("id, name, color").order("name");
        setReviewableProjects((data ?? []) as ReviewableProject[]);
      } else {
        const { data } = await supabase
          .from("project_members")
          .select("project_id, projects(name, color)")
          .eq("user_id", user.id)
          .eq("is_pm", true);
        const list = ((data ?? []) as unknown as { project_id: string; projects: { name: string; color: string | null } | null }[])
          .map((r) => ({
            id: r.project_id,
            name: r.projects?.name ?? "Untitled project",
            color: r.projects?.color ?? null,
          }))
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

  // Wishlist for the selected project (left column, under the roster), ordered
  // by the PM-chosen `position`.
  const loadWishlist = useCallback(async (projectId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("application_wishlist")
      .select("application_id")
      .eq("project_id", projectId)
      .order("position");
    setWishlist((data ?? []).map((r: { application_id: string }) => r.application_id));
  }, []);

  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) { setWishlist(null); return; }
    setWishlist(null);
    loadWishlist(selectedProjectId);
  }, [selectedProjectId, loadWishlist]);

  // Persist the wishlist order by writing every row's position (mirrors the
  // ranking page's syncRanks). Cheap for the handful of rows a wishlist holds.
  const syncWishlistOrder = useCallback(async (order: string[]) => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) return;
    const supabase = createClient();
    await Promise.all(
      order.map((appId, i) =>
        supabase
          .from("application_wishlist")
          .update({ position: i })
          .eq("application_id", appId)
          .eq("project_id", selectedProjectId),
      ),
    );
  }, [selectedProjectId]);

  // Persist the net result of a drag (add / remove / reorder) in one pass by
  // diffing the dropped order against the committed one -- mirrors the ranking
  // page's commitRanked. onDragEnd has already set the new order on screen, so
  // this only writes.
  const commitWishlist = useCallback(async (next: string[]) => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) return;
    const prev = wishlist ?? [];
    const added = next.filter((id) => !prev.includes(id));
    const removed = prev.filter((id) => !next.includes(id));
    const supabase = createClient();
    if (added.length) {
      await supabase.from("application_wishlist").upsert(
        added.map((appId) => ({
          application_id: appId,
          project_id: selectedProjectId,
          created_by: currentUserId,
          position: next.indexOf(appId),
        })),
        { onConflict: "application_id,project_id", ignoreDuplicates: true },
      );
    }
    if (removed.length) {
      await supabase
        .from("application_wishlist")
        .delete()
        .eq("project_id", selectedProjectId)
        .in("application_id", removed);
    }
    await syncWishlistOrder(next);
  }, [wishlist, selectedProjectId, currentUserId, syncWishlistOrder]);

  // Root of the Applicants column (wishlist + choice groups). Click add/remove
  // FLIP-animates cards between the two; drag uses dnd-kit instead.
  const applicantsColumnRef = useRef<HTMLDivElement>(null);

  // Button-driven add: append to the end of the wishlist. A no-op if already
  // shortlisted. The applicant leaves their choice group below (a move, not a
  // copy) -- groupedApps filters the wishlist out.
  const addToWishlist = useCallback(async (applicationId: string) => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) return;
    let position = 0;
    let changed = false;
    flipMove(applicantsColumnRef.current, () => {
      setWishlist((prev) => {
        const cur = prev ?? [];
        if (cur.includes(applicationId)) return cur;
        changed = true;
        position = cur.length;
        return [...cur, applicationId];
      });
    }, { emphasizeId: applicationId });
    if (!changed) return;
    const supabase = createClient();
    const { error } = await supabase.from("application_wishlist").upsert(
      { application_id: applicationId, project_id: selectedProjectId, created_by: currentUserId, position },
      { onConflict: "application_id,project_id", ignoreDuplicates: true },
    );
    if (error) {
      flipMove(applicantsColumnRef.current, () => {
        setWishlist((prev) => (prev ? prev.filter((id) => id !== applicationId) : prev));
      });
      toast.error("Couldn't save wishlist", { description: error.message });
    }
  }, [selectedProjectId, currentUserId]);

  const removeFromWishlist = useCallback(async (applicationId: string) => {
    if (!selectedProjectId || selectedProjectId === ALL_PROJECTS) return;
    let index = -1;
    flipMove(applicantsColumnRef.current, () => {
      setWishlist((prev) => {
        index = prev ? prev.indexOf(applicationId) : -1;
        return prev ? prev.filter((id) => id !== applicationId) : prev;
      });
    }, { emphasizeId: applicationId });
    const supabase = createClient();
    const { error } = await supabase
      .from("application_wishlist")
      .delete()
      .eq("application_id", applicationId)
      .eq("project_id", selectedProjectId);
    if (error) {
      flipMove(applicantsColumnRef.current, () => {
        setWishlist((prev) => {
          if (!prev || prev.includes(applicationId)) return prev;
          const next = [...prev];
          next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, applicationId);
          return next;
        });
      });
      toast.error("Couldn't save wishlist", { description: error.message });
    }
  }, [selectedProjectId]);

  // Draft-round state for the selected project (Confirmed/Draft window,
  // shown once a draft is active). Independent of the wishlist -- an
  // applicant can be staged into the draft window from the Applicants list or
  // the wishlist (a copy -- the source keeps its card).
  const draftPicks = useDraftPicks(!allSelected ? selectedProjectId : null, selectedPeriodId);

  // Stable callbacks for the (memoized) applicant cards. draftPicks' own
  // callbacks change identity every render (nextRound is recomputed), which
  // would defeat the card memo during a drag, so route through a ref.
  const draftPicksRef = useRef(draftPicks);
  draftPicksRef.current = draftPicks;
  const stageInDraft = useCallback((id: string) => {
    if (draftPicksRef.current.claimedByOther[id]) return;
    draftPicksRef.current.addToDraftWindow(id);
  }, []);
  const onReviewApp = useCallback(
    (a: AppRow) => setReviewFor({ id: a.id, name: applicantName(a), status: a.status, recruiting: recruitingOf(a) }),
    [],
  );

  // Submitting only locks the round's picks in as "confirmed" -- it doesn't
  // place anyone on the roster yet (that's a separate "Complete draft" step
  // a VP takes for the whole period, from /manager/draft), so there's
  // nothing here that needs the roster/apps to reload.
  const handleSubmitDraftPicks = () => draftPicks.submit();

  // ---- Drag orchestration (multi-container sortable) ----------------------
  // The same model as the application ranking page: both lists are sortable
  // containers over raw application ids, and `dragWishlist` is a working copy of
  // the wishlist mutated live on hover, so a card can be dropped into any slot
  // and both lists reflow under the pointer. The choice groups derive from it
  // too (groupedApps filters the live set), so a card leaves its group the
  // instant it's previewed into the wishlist and returns to its sorted position
  // when dragged back out. The draft window is the one exception -- a copy
  // target, not a third list.
  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setDragWishlistLive([...(wishlist ?? [])]);
  }, [wishlist]);

  const onDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // Dropping on the draft window stages a copy and leaves both lists exactly
    // as they were, so hovering it must not pull the card out of the wishlist.
    if (overId === DRAFT_WINDOW_DROPZONE_ID) return;
    const base = dragWishlistRef.current ?? wishlist ?? [];
    const inWishlist = base.includes(activeId);
    const overWishlist = overId === WISHLIST_DROPZONE_ID || base.includes(overId);

    // Choice groups -> wishlist: insert at the hovered slot.
    if (!inWishlist && overWishlist) {
      let newIndex: number;
      if (overId === WISHLIST_DROPZONE_ID) {
        newIndex = base.length;
      } else {
        const overIndex = base.indexOf(overId);
        const translated = active.rect.current.translated;
        const isBelow = translated && over.rect ? translated.top > over.rect.top + over.rect.height / 2 : false;
        newIndex = overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : base.length;
      }
      const next = [...base];
      next.splice(newIndex, 0, activeId);
      setDragWishlistLive(next);
      return;
    }

    // Wishlist -> choice groups: pull it out; it reappears in its rank group.
    if (inWishlist && !overWishlist) {
      setDragWishlistLive(base.filter((id) => id !== activeId));
      return;
    }

    // Reorder within the wishlist.
    if (inWishlist && overWishlist) {
      const from = base.indexOf(activeId);
      const to = overId === WISHLIST_DROPZONE_ID ? base.length - 1 : base.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      setDragWishlistLive(arrayMove(base, from, to));
    }
  }, [wishlist]);

  // Unlike the ranking page this still reads the event, but only to spot a drop
  // on the draft window. Every other drop commits whatever the last hover left
  // in the working copy -- releasing over the gutter included, since
  // closestCorners always resolves to a zone. Escape still reverts, via
  // onDragCancel.
  const onDragEnd = useCallback((event: DragEndEvent) => {
    const result = dragWishlistRef.current;
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    setActiveDragId(null);
    setDragWishlistLive(null);

    // Draft window is a plain copy target -- the source keeps its card, and the
    // wishlist is left as it was. Claimed-by-other applicants can't be staged.
    if (overId === DRAFT_WINDOW_DROPZONE_ID) {
      if (!draftPicks.claimedByOther[activeId]) draftPicks.addToDraftWindow(activeId);
      return;
    }

    // Keep the dropped order on screen immediately; commitWishlist reconciles
    // the DB against the still-current committed `wishlist`.
    if (result && !sameOrder(result, wishlist ?? [])) {
      setWishlist(result);
      commitWishlist(result);
    }
  }, [wishlist, draftPicks, commitWishlist]);

  const onDragCancel = useCallback(() => {
    setActiveDragId(null);
    setDragWishlistLive(null);
  }, []);

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
        .in("status", ["submitted", "accepted"])
        .eq("application_rankings.project_id", selectedProjectId)
        .eq("application_rankings.ranked", true)
        .order("submitted_at", { ascending: true });

      const rows = ((data ?? []) as unknown as { id: string; status: ReviewStatus; submitted_at: string | null; applicant_id: string | null; application_rankings: { rank: number }[] }[])
        .map(({ application_rankings, ...r }) => ({ ...r, rank: application_rankings[0]?.rank ?? 0 }));
      setApps(await enrichAppRows(supabase, rows, { excludeWishlistProjectId: selectedProjectId, periodId: selectedPeriodId }));
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

  const appById = new Map((apps ?? []).map((a) => [a.id, a]));

  // Picks for applicants who never ranked this project (placed from the
  // board, moved here) aren't in `apps`; resolve their names and status so
  // Invited / Draft window never fall back to "Applicant".
  const [pickInfo, setPickInfo] = useState<Record<string, { name: string; status: ReviewStatus }>>({});
  const missingPickKey = [...draftPicks.confirmedPicks, ...draftPicks.draftWindowPicks]
    .map((p) => p.application_id)
    .filter((id) => !appById.has(id) && !pickInfo[id])
    .sort()
    .join(",");
  useEffect(() => {
    if (!missingPickKey) return;
    const ids = missingPickKey.split(",");
    const supabase = createClient();
    (async () => {
      const { data: rows } = await supabase.from("applications").select("id, applicant_id, status").in("id", ids);
      const list = (rows ?? []) as { id: string; applicant_id: string | null; status: ReviewStatus }[];
      const uids = [...new Set(list.map((r) => r.applicant_id).filter((u): u is string => !!u))];
      const { data: mems } = uids.length
        ? await supabase.from("members").select("user_id, preferred_firstname, lastname").in("user_id", uids)
        : { data: [] };
      const nameOf = new Map(
        ((mems ?? []) as { user_id: string; preferred_firstname: string | null; lastname: string | null }[]).map((m) => [
          m.user_id,
          [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Applicant",
        ]),
      );
      setPickInfo((prev) => {
        const next = { ...prev };
        for (const r of list) next[r.id] = { name: (r.applicant_id && nameOf.get(r.applicant_id)) || "Applicant", status: r.status };
        return next;
      });
    })();
  }, [missingPickKey]);

  // Applicants currently staged in the draft window or already confirmed this
  // draft -- used to disable their "add to draft window" button (they can't be
  // staged twice), not to hide them: staging is still a copy, so a staged
  // applicant keeps their card on the wishlist or in their choice group.
  const draftedIds = new Set([
    ...draftPicks.draftWindowPicks.map((p) => p.application_id),
    ...draftPicks.confirmedPicks.map((p) => p.application_id),
  ]);

  // The two halves of draftedIds, kept apart because they paint differently: a
  // card in the Applicants column takes on the colour of the panel its
  // applicant is sitting in -- the project accent once confirmed, the draft
  // window's white while merely staged. Spread onto the card, which resolves
  // the precedence.
  const stagedIds = new Set(draftPicks.draftWindowPicks.map((p) => p.application_id));
  const projectAccent = selectedProject?.color || DEFAULT_ACCENT;
  const cardDraftState = (id: string): { staged?: boolean; claimedBy?: string } => {
    const claimed = draftPicks.claimedByOther[id];
    if (claimed) return { claimedBy: claimed.name };
    return stagedIds.has(id) ? { staged: true } : {};
  };

  // The wishlist and choice lists only show who is still available: anyone
  // staged in the draft window, invited (confirmed) by this project, picked by
  // another project, or already accepted lives elsewhere now (the draft
  // window, Invited, On the team).
  // (Picked by another project stays listed, greyed with that project's name,
  // so the wishlist still shows who you lost and to whom.)
  const unavailable = (a: AppRow) => draftedIds.has(a.id) || (a.status === "accepted" && !draftPicks.claimedByOther[a.id]);

  // Search + filters over the wishlist and choice lists. They only hide rows;
  // drag order is computed on the full lists, so reordering stays correct.
  const q = appQuery.trim().toLowerCase();
  const matchesView = (a: AppRow) => {
    if (q && !applicantName(a).toLowerCase().includes(q)) return false;
    for (const f of appFilters) {
      if (f === "meets" && !a.valid) return false;
      if (f === "missing" && a.valid) return false;
      if (f === "returning" && !a.returning) return false;
      if (f === "first" && a.returning) return false;
      if (f === "late" && !isLate(a.submitted_at, selectedPeriod?.ends_at)) return false;
      if (f === "wishlisted" && a.wishlistedBy.length === 0) return false;
      if (f === "available" && draftPicks.claimedByOther[a.id]) return false;
    }
    return true;
  };

  // While a drag is live, both lists render from the working copy so they
  // reflow: the wishlist shows the insertion preview, and groupedApps (which
  // filters on wishlistSet) drops or restores the card in its choice group.
  const wishlistView = dragWishlist ?? wishlist ?? [];
  const wishlistApps = wishlistView
    .map((id) => appById.get(id))
    .filter((a): a is AppRow => !!a && !unavailable(a) && matchesView(a));
  const wishlistSet = new Set(wishlistView);
  // Staging (add-to-draft buttons + the draft-window drop zone) is allowed
  // whenever the draft is running -- started and not yet completed -- even
  // before this project's turn, so a PM can prepare their board ahead of time.
  // Locked before the draft starts and after it completes. Submitting is still
  // gated on isMyTurn (below / in the panel).
  const draftActive = draftPicks.phase === "in_progress" && !!draftPicks.nextRound;
  const activeApp = activeDragId ? appById.get(activeDragId) ?? null : null;

  // Group applicants into rank sections (1st choice, 2nd choice, …) for the
  // currently selected project, most-preferred first. Within a rank, returning
  // members float to the top; late sinks below on-time; invalid sinks below
  // late (returning still wins if both apply). Shortlisted applicants are
  // filtered out -- their card has moved up to the wishlist, so nobody is
  // listed twice -- and the filter reads the live wishlistSet, so that move
  // happens under the pointer rather than on drop. A group whose members are
  // all shortlisted simply stops being created.
  const groupedApps = apps
    ? Object.entries(
        apps
          .filter((a) => !wishlistSet.has(a.id) && !unavailable(a) && matchesView(a))
          .reduce<Record<number, AppRow[]>>((acc, a) => {
            (acc[a.rank] ??= []).push(a);
            return acc;
          }, {}),
      )
        .map(([rank, list]) => [
          Number(rank),
          [...list].sort((a, b) =>
            compareReviewPriority(
              { returning: a.returning, submittedAt: a.submitted_at, valid: a.valid },
              { returning: b.returning, submittedAt: b.submitted_at, valid: b.valid },
              selectedPeriod?.ends_at,
            ),
          ),
        ] as [number, AppRow[]])
        .sort((x, y) => x[0] - y[0])
    : [];

  const onReviewed = (id: string, status: ReviewStatus) => {
    setApps((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, status } : a)) : prev));
    if (isExec && selectedPeriodId) loadStats(selectedPeriodId);
    // Accepting adds the applicant to project_members — refresh the roster so
    // they show up on the left without a full page reload.
    if (status === "accepted" && selectedProjectId && !allSelected) loadRoster(selectedProjectId);
    if (allSelected) setBoardReloadToken((n) => n + 1);
    if (sheetOpen) setSheetReloadToken((n) => n + 1);
  };

  return (
    // The cross-project board scrolls sideways inside the header's width
    // (max-w-6xl, same 20px gutter): three 300px columns fit and the fourth is
    // cut a little past halfway, which says "scroll for more".
    <div className={`w-full ${allSelected ? "max-w-6xl" : "max-w-5xl"} mx-auto p-5 flex flex-col gap-6`}>
      <div className="flex flex-col gap-1">
        <BackLink href="/manager" label="Manager" />
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <InfoHint label="About this page">
            Review submitted applications and accept applicants into a project. Use &ldquo;View as&rdquo; (bottom right) to preview the accepted-member experience.
          </InfoHint>
        </div>
      </div>

      {/* Period bar: the period picker (which also holds "Manage periods") on
          the left, the exec-only tools as icons on the right. */}
      <div className="flex flex-wrap items-center gap-3">
        {periods === null ? (
          <div className="h-9 w-48 rounded-md bg-foreground/[0.09] animate-pulse" />
        ) : (
          // Rendered even with no periods yet, since "Manage periods" -- the only
          // way to create the first one -- lives inside it.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <span className="font-medium">
                  {selectedPeriod?.name ?? (periods.length === 0 ? "No periods yet" : "Select period")}
                </span>
                {selectedPeriod && <PeriodStatusText period={selectedPeriod} />}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {periods.length === 0 && !isExec && (
                <DropdownMenuItem disabled>No application periods yet</DropdownMenuItem>
              )}
              {periods.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setSelectedPeriodId(p.id)} className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <PeriodStatusText period={p} />
                </DropdownMenuItem>
              ))}
              {isExec && (
                <>
                  {periods.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    // Next frame: the menu finishes closing before the dialog takes focus.
                    onSelect={() => requestAnimationFrame(() => setPeriodsDialogOpen(true))}
                    className="flex items-center gap-2"
                  >
                    <SlidersHorizontal size={14} className="text-muted-foreground" />
                    Manage periods
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canEmailBlast && selectedPeriod && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Email blast"
                  onClick={() => setEmailBlastOpen(true)}
                >
                  <Mail size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Email blast</TooltipContent>
            </Tooltip>
          )}

          {isExec && selectedPeriodId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="View analytics"
                  onClick={() => setAnalyticsOpen(true)}
                >
                  <BarChart3 size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">View analytics</TooltipContent>
            </Tooltip>
          )}
        </div>
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
            // Searchable: execs switch between ~20 projects all review long.
            <Combobox
              aria-label="Reviewing for"
              className="w-auto min-w-56 self-start"
              contentClassName="w-72"
              value={allSelected ? ALL_PROJECTS : selectedProject?.id ?? null}
              onChange={setSelectedProjectId}
              options={[
                ...(fullAccessReview ? [{ value: ALL_PROJECTS, label: "All projects" }] : []),
                ...reviewableProjects.map((p) => ({ value: p.id, label: p.name })),
              ]}
              placeholder="Select project"
              searchPlaceholder="Search projects…"
              renderValue={(o) => <span className="truncate font-medium text-foreground">{o.label}</span>}
            />
          )}
        </div>
      )}
      {reviewableProjects === null && <div className="h-9 w-48 rounded-md bg-foreground/[0.09] animate-pulse" />}

      {isExec && (
        <AnalyticsModal
          open={analyticsOpen}
          onOpenChange={setAnalyticsOpen}
          periods={periods ?? []}
          initialPeriodId={selectedPeriodId}
        />
      )}

      {/* Split view: current team on the left, applicants left to review
          (grouped by rank: 1st choice, 2nd choice, …) on the right */}
      {reviewableProjects?.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground rounded-xl surface">
          You aren&apos;t assigned to review any projects.
        </div>
      ) : allSelected ? (
        // Cross-project mode has no single roster or rank grouping, so it shows
        // every project side by side instead -- read-only, with the sheet and
        // the draft manager still a click away.
        <AllProjectsBoard
          periodId={selectedPeriodId}
          periodEndsAt={selectedPeriod?.ends_at}
          counts={allCounts}
          canDraft={fullAccessReview}
          onOpenSheet={() => setSheetOpen(true)}
          onReview={(app, projectId) =>
            setReviewFor({ id: app.id, name: applicantName(app), status: app.status, projectId, recruiting: recruitingOf(app) })
          }
          reviewOpen={!!reviewFor}
          reloadToken={boardReloadToken}
          // The board reloads its own columns; this is for what the page owns.
          onMutated={() => {
            if (isExec && selectedPeriodId) loadStats(selectedPeriodId);
            if (sheetOpen) setSheetReloadToken((n) => n + 1);
          }}
        />
      ) : (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: who's already on the team, then the draft window */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2.5">
                <h2 className="text-base font-semibold tracking-tight">
                  On the team
                  {roster && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{roster.length}</span>}
                </h2>
                {roster === null ? (
                  <ApplicationListSkeleton rows={3} />
                ) : roster.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground rounded-xl surface">
                    No one on this project yet.
                  </div>
                ) : (
                  // One panel of rows rather than a card per person.
                  <div className="flex flex-col rounded-xl surface p-1.5">
                    {roster.map((m, i) => (
                      <div key={m.user_id} style={staggerStyle(i)} className="animate-fade-in-up flex items-center gap-2 rounded-lg px-3 py-2">
                        <PersonName userId={m.user_id} name={m.name} className="text-sm font-medium" />
                        {m.isPm && (
                          <span aria-label="PM" className="inline-flex">
                            <AdminCrown active size={13} />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {draftPicks.error && <p className="text-sm text-destructive">{draftPicks.error}</p>}

              <DraftWindowPanel
                appById={appById}
                periodEndsAt={selectedPeriod?.ends_at}
                onReview={onReviewApp}
                phase={draftPicks.phase}
                currentTurn={draftPicks.currentTurn}
                myPosition={draftPicks.myPosition}
                canStage={draftActive}
                nextRound={draftPicks.nextRound}
                isMyTurn={draftPicks.isMyTurn}
                canUnsubmitCurrent={draftPicks.canUnsubmitCurrent}
                draftWindowPicks={draftPicks.draftWindowPicks}
                confirmedPicks={draftPicks.confirmedPicks}
                onSubmit={handleSubmitDraftPicks}
                onUnsubmit={draftPicks.unsubmit}
                onRemove={draftPicks.removeFromDraftWindow}
                accent={projectAccent}
                pickInfo={pickInfo}
              />
            </div>

            {/* Right: every applicant for this project -- the shortlist on top,
                then whoever's left, grouped by choice. An applicant sits in
                exactly one of the two, and a card drags freely between them.
                The wishlist is a sibling of (never nested in) ApplicantsZone so
                the two stay distinct drop targets. */}
            <div ref={applicantsColumnRef} className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <h2 className="text-base font-semibold tracking-tight">
                    Applicants
                    {/* Still available: excludes anyone staged, invited, picked elsewhere or accepted. */}
                    {apps && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{apps.filter((a) => !unavailable(a)).length}</span>}
                  </h2>
                </div>
                {selectedPeriodId && selectedProjectId && (
                  <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shrink-0" onClick={() => setSheetOpen(true)}>
                    <Table2 size={13} className="mr-1.5" />
                    Sheet view
                  </Button>
                )}
              </div>

              {/* Search + filter the lists below. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    value={appQuery}
                    onChange={(e) => setAppQuery(e.target.value)}
                    placeholder="Search applicants…"
                    aria-label="Search applicants"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <MultiSelectFilter
                  label="Filter"
                  align="end"
                  className="h-8 px-3 text-xs"
                  options={APP_FILTERS}
                  selected={appFilters}
                  onToggle={(key) =>
                    setAppFilters((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  onClear={() => setAppFilters(new Set())}
                />
              </div>

              <div className="flex flex-col gap-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Wishlist {wishlist && <span className="font-normal tabular-nums">{wishlistApps.length}</span>}
                </h3>
                <WishlistDropzone
                  apps={wishlistApps}
                  periodEndsAt={selectedPeriod?.ends_at}
                  draftActive={draftActive}
                  addToDraftDisabled={(id) => draftedIds.has(id) || !!draftPicks.claimedByOther[id]}
                  cardDraftState={cardDraftState}
                  onReview={onReviewApp}
                  onWishlistToggle={removeFromWishlist}
                  onAddToDraft={stageInDraft}
                />
              </div>

              <ApplicantsZone items={groupedApps.flatMap(([, list]) => list.map((a) => a.id))}>
                {apps === null ? (
                  <ApplicationListSkeleton rows={4} />
                ) : apps.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground rounded-xl surface">
                    No submitted applications for this project yet.
                  </div>
                ) : groupedApps.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground rounded-xl surface">
                    {q || appFilters.size > 0 ? "No applicants match." : <>Everyone&apos;s on the wishlist.</>}
                  </div>
                ) : (
                  groupedApps.map(([rank, list], gi) => (
                    <div key={rank} className="flex flex-col gap-1 animate-fade-in-up" style={staggerStyle(gi + 1)}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {rankLabel(rank)} <span className="font-normal tabular-nums">{list.length}</span>
                      </h3>
                      <div className="flex flex-col divide-y divide-foreground/[0.06]">
                      {list.map((a) => (
                        <SortableApplicantCard
                          key={a.id}
                          app={a}
                          {...cardDraftState(a.id)}
                          periodEndsAt={selectedPeriod?.ends_at}
                          onAddToWishlist={addToWishlist}
                          showAddToDraft={draftActive}
                          onAddToDraft={stageInDraft}
                          addToDraftDisabled={draftedIds.has(a.id) || !!draftPicks.claimedByOther[a.id]}
                          onReview={onReviewApp}
                        />
                      ))}
                      </div>
                    </div>
                  ))
                )}
              </ApplicantsZone>
            </div>
          </div>

          {/* The picked-up card tracks the pointer; the lists reflow under it. */}
          <DragOverlay dropAnimation={null}>
            {activeApp ? (
              <StaticApplicantCard
                app={activeApp}
                {...cardDraftState(activeApp.id)}
                periodEndsAt={selectedPeriod?.ends_at}
                onReview={onReviewApp}
                draggable
              />
            ) : null}
          </DragOverlay>
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
        canEditRecruiting={isBoardOrExec}
        onReview={(row) => setReviewFor(row)}
        onRecruitingChanged={() => {
          setAppsReloadToken((n) => n + 1);
          if (isExec && selectedPeriodId) loadStats(selectedPeriodId);
        }}
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
          recruiting={reviewFor.recruiting}
          open={!!reviewFor}
          onOpenChange={(o) => { if (!o) setReviewFor(null); }}
          onReviewed={(status) => onReviewed(reviewFor.id, status)}
        />
      )}
    </div>
  );
}
