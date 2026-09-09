"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Check, X, ArrowUp, ArrowDown, Download, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { PersonName } from "@/components/person-profile-provider";
import { CoffeeChatIndicator, InfosessionIndicator, LateBadge, type CoffeeState } from "@/components/applicant-indicators";
import { coffeeWithByApplicant } from "@/lib/coffee-chat-indicator";
import {
  SheetCoffeeCell,
  SheetInfosessionCell,
  SheetReturningCell,
  type CoffeeEditResult,
} from "@/components/sheet-recruiting-editors";
import { type FocusSection, type ReviewStatus } from "@/components/application-review-modal";
import { pct } from "@/components/donut-chart";
import { rankLabel } from "@/lib/application-rank";
import { isChoiceType, type AnswerValue, type ProjectQuestion, type QuestionType } from "@/lib/application";
import {
  TECH_CLASSES,
  techAreaLabel,
  techClassLabel,
} from "@/lib/application-profile";
import { csvSlug, downloadCsv } from "@/lib/csv";
import { isReturningMember, type MemberStatus } from "@/lib/member-status";
import { cn, compareReviewPriority, isLate, isRecruitingValid } from "@/lib/utils";

type PageProject = { id: string; name: string; type: string; essay_prompt: string | null };

// A page of the sheet. The overview lists every applicant in the period with
// only their global info; a project page lists the applicants who ranked that
// one project, with its essay and questions.
type SheetPage = { kind: "overview" } | { kind: "project"; project: PageProject };

// The highest rank an applicant can give (application_rankings.rank is 1..7).
const MAX_RANK = 7;

type RankedProject = { id: string; name: string };

type SheetRow = {
  id: string;
  status: ReviewStatus;
  submittedAt: string | null;
  applicantId: string;
  name: string;
  rank: number;
  gradYear: string;
  returning: boolean;
  // Raw members.status — needed so returning edits only flip non_member ↔ inactive.
  memberStatus: MemberStatus | null;
  coffee: CoffeeState;
  // Hosts this applicant completed (done) or booked (booked) a coffee chat with.
  coffeeWith: string[];
  coffeeHostIds: string[];
  projectCoffee: "met" | "missing" | null; // null = not a studio project
  infosession: boolean;
  // Applicant currently holds a board/exec role (auto-valid).
  boardExec: boolean;
  // Board/exec or returning, or coffee done + info attended and not 3+ days late.
  // Mirrors application_analytics both_valid.
  valid: boolean;
  techClasses: string[];
  techClassesOther: string | null;
  topAreas: string[];
  portfolioUrl: string | null;
  aboutNote: string | null;
  essay: string | null;
  // This applicant's answers to the active project's questions, by question id.
  answers: Record<string, AnswerValue>;
  // Overview only: the project this applicant put in each rank slot.
  slots: Record<number, RankedProject>;
  // Lowercased blob of everything on the row, for the search box.
  search: string;
};

function sheetValid(
  r: Pick<SheetRow, "boardExec" | "returning" | "coffee" | "infosession" | "submittedAt">,
  endsAt?: string | null,
): boolean {
  return isRecruitingValid({
    boardExec: r.boardExec,
    returning: r.returning,
    coffeeDone: r.coffee === "done",
    infosession: r.infosession,
    submittedAt: r.submittedAt,
    endsAt,
  });
}

// Same priority as coffeeWithByApplicant: completed hosts when any chat is done,
// otherwise booked hosts.
function coffeeHostIdsByApplicant(
  chats: { applicant_id: string; member_id: string; complete: boolean }[],
): Record<string, string[]> {
  const completedIds: Record<string, string[]> = {};
  const bookedIds: Record<string, string[]> = {};
  const done = new Set<string>();
  for (const ch of chats) {
    if (ch.complete) {
      done.add(ch.applicant_id);
      (completedIds[ch.applicant_id] ??= []).push(ch.member_id);
    } else {
      (bookedIds[ch.applicant_id] ??= []).push(ch.member_id);
    }
  }
  const out: Record<string, string[]> = {};
  for (const aid of new Set([...Object.keys(completedIds), ...Object.keys(bookedIds)])) {
    const ids = done.has(aid) ? completedIds[aid] ?? [] : bookedIds[aid] ?? [];
    const seen = new Set<string>();
    out[aid] = ids.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  return out;
}

type TriFilter = "any" | "yes" | "no";
type CoffeeFilter = "any" | CoffeeState;
type ProjectCoffeeFilter = "any" | "met" | "missing";
type DecisionFilter = "any" | "pending" | "accepted" | "rejected";
type SortKey =
  | "rank"
  | "name"
  | "submitted"
  | "year"
  | "coffee"
  | "projectCoffee"
  | "returning"
  | "info"
  | "valid";
type SortState = { key: SortKey; dir: "asc" | "desc" };

type FilterOption = { value: string; label: string };

const CLASS_ORDER: Record<string, number> = {
  freshman: 1,
  sophomore: 2,
  junior: 3,
  senior: 4,
  "5th year": 5,
  postgrad: 6,
  "post-grad": 6,
  graduate: 6,
  grad: 6,
};

function classRank(label: string): number {
  return CLASS_ORDER[label.trim().toLowerCase()] ?? (label === "—" ? 99 : 90);
}

const COFFEE_SORT: Record<CoffeeState, number> = { done: 0, booked: 1, none: 2 };

// Compact enough for a table cell; matches the timestamp cells in the manager
// info-session table. The year is left to the cell's title attribute.
function submittedLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Exports read like the table rather than like the enum columns behind it.
const COFFEE_CSV: Record<CoffeeState, string> = { done: "Done", booked: "Booked", none: "" };
const DECISION_CSV: Record<ReviewStatus, string> = {
  submitted: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

const PAGE_SIZE = 50;

// Stable empty selection for question columns nobody has filtered yet.
const NO_SELECTION: Set<string> = new Set();

// Each header menu is its own Radix root, so they don't know about each other.
// The sheet owns which column's menu is open (keyed on the column's menu id,
// unique per table) so opening one closes any other — never two at once.
type MenuControl = {
  openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
};

// Column header that doubles as its own sort/filter control: clicking the label
// opens a menu with the sort directions (when the column is sortable) and that
// column's filter. `active` marks a column whose filter is narrowing the rows.
function HeaderMenu({
  label,
  // Defaults to the label, which is unique among the fixed columns. Question
  // columns pass their question id, since two prompts can read the same.
  menuId,
  columnKey,
  sort,
  onSort,
  menu,
  active,
  onClear,
  className,
  title,
  children,
}: {
  label: string;
  menuId?: string;
  columnKey?: SortKey;
  sort: SortState;
  onSort: (s: SortState) => void;
  menu: MenuControl;
  active?: boolean;
  onClear?: () => void;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const id = menuId ?? label;
  const sorted = !!columnKey && sort.key === columnKey;
  const { openId, setOpenId } = menu;
  return (
    <DropdownMenu
      open={openId === id}
      onOpenChange={(o) => setOpenId((cur) => (o ? id : cur === id ? null : cur))}
    >
      <DropdownMenuTrigger asChild>
        <button
          title={title}
          className={cn(
            "flex w-full items-center gap-1 text-left hover:text-foreground transition-colors",
            (sorted || active) && "text-foreground",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          {active && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500" aria-hidden />}
          {sorted ? (
            sort.dir === "asc" ? (
              <ArrowUp size={11} className="flex-shrink-0" />
            ) : (
              <ArrowDown size={11} className="flex-shrink-0" />
            )
          ) : (
            <ChevronDown size={11} className="flex-shrink-0 text-muted-foreground/50" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72">
        {columnKey && (
          <>
            <DropdownMenuItem className="text-xs" onSelect={() => onSort({ key: columnKey, dir: "asc" })}>
              <ArrowUp size={12} className="mr-1.5" />
              Sort ascending
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onSelect={() => onSort({ key: columnKey, dir: "desc" })}>
              <ArrowDown size={12} className="mr-1.5" />
              Sort descending
            </DropdownMenuItem>
            {children && <DropdownMenuSeparator />}
          </>
        )}
        {children}
        {active && onClear && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onSelect={onClear}>
              Clear filter
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Single-choice filter body for a HeaderMenu ("any" = unfiltered).
function RadioFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
}) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
      {options.map((o) => (
        <DropdownMenuRadioItem key={o.value} value={o.value} className="text-xs">
          {o.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

// Multi-select filter body for a HeaderMenu (empty selection = unfiltered).
function CheckFilter({
  options,
  selected,
  onToggle,
}: {
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) {
    return (
      <DropdownMenuItem disabled className="text-xs text-muted-foreground">
        No values
      </DropdownMenuItem>
    );
  }
  return (
    <>
      {options.map((o) => (
        <DropdownMenuCheckboxItem
          key={o.value}
          checked={selected.has(o.value)}
          onCheckedChange={() => onToggle(o.value)}
          onSelect={(e) => e.preventDefault()}
          className="text-xs"
        >
          {o.label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}

const YES_NO: FilterOption[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

// A choice question stores its selection in answer_options and a text question
// in answer, so exactly one of the two is ever populated.
function answerText(r: SheetRow, questionId: string): string {
  const v = r.answers[questionId];
  if (!v) return "";
  return v.options.length ? v.options.join(", ") : v.text;
}

type MemberInfo = {
  preferred_firstname: string | null;
  lastname: string | null;
  status: string | null;
  grad_year: string | null;
};

// Everything about an applicant that doesn't depend on which page is open:
// their name/year, coffee-chat state, and info-session attendance. Shared by
// the overview and project loaders, which differ only in the ranking data.
async function loadApplicantContext(supabase: ReturnType<typeof createClient>, ids: string[]) {
  const memById: Record<string, MemberInfo> = {};
  const coffeeById: Record<string, CoffeeState> = {};
  // applicant -> members they've completed a chat with, for the PM check.
  const completedWith: Record<string, Set<string>> = {};
  let coffeeWithById: Record<string, string[]> = {};
  let coffeeHostIdsById: Record<string, string[]> = {};
  const attendedInfo = new Set<string>();
  // Applicants who currently hold a board- or exec-level role; they're
  // auto-valid, regardless of coffee chat / info session.
  const boardExecIds = new Set<string>();

  if (!ids.length) {
    return { memById, coffeeById, completedWith, coffeeWithById, coffeeHostIdsById, attendedInfo, boardExecIds };
  }

  const idSet = new Set(ids);
  const [{ data: mem }, { data: chats }, { data: info }, { data: roleRows }] = await Promise.all([
    supabase.from("members").select("user_id, preferred_firstname, lastname, status, grad_year").in("user_id", ids),
    supabase.from("coffee_chats").select("applicant_id, member_id, complete").in("applicant_id", ids),
    // Attendance is recorded under member_id or applicant_id depending on
    // whether they were a member at the time; both are auth user ids.
    supabase
      .from("infosesh_attendance")
      .select("applicant_id, member_id")
      .or(`applicant_id.in.(${ids.join(",")}),member_id.in.(${ids.join(",")})`),
    // Board/exec = access_level in ('board','exec'), same grouping as the
    // is_board_or_exec() SQL helper. Inner join + filter returns only the rows
    // for applicants who hold such a role.
    supabase
      .from("members_roles")
      .select("user_id, roles!inner(access_level)")
      .in("user_id", ids)
      .in("roles.access_level", ["board", "exec"]),
  ]);

  for (const m of (mem ?? []) as (MemberInfo & { user_id: string })[]) {
    memById[m.user_id] = m;
  }

  for (const r of (roleRows ?? []) as { user_id: string | null }[]) {
    if (r.user_id) boardExecIds.add(r.user_id);
  }

  const chatRows = (chats ?? []) as { applicant_id: string; member_id: string; complete: boolean }[];
  for (const ch of chatRows) {
    if (ch.complete) coffeeById[ch.applicant_id] = "done";
    else if (coffeeById[ch.applicant_id] !== "done") coffeeById[ch.applicant_id] = "booked";
    if (ch.complete) (completedWith[ch.applicant_id] ??= new Set()).add(ch.member_id);
  }

  const hostIds = [...new Set(chatRows.map((ch) => ch.member_id).filter(Boolean))];
  const hostNameById: Record<string, string> = {};
  if (hostIds.length) {
    const { data: hosts } = await supabase
      .from("members")
      .select("user_id, preferred_firstname, lastname")
      .in("user_id", hostIds);
    for (const h of (hosts ?? []) as { user_id: string; preferred_firstname: string | null; lastname: string | null }[]) {
      const name = [h.preferred_firstname, h.lastname].filter(Boolean).join(" ");
      if (name) hostNameById[h.user_id] = name;
    }
  }
  coffeeWithById = coffeeWithByApplicant(chatRows, hostNameById);
  coffeeHostIdsById = coffeeHostIdsByApplicant(chatRows);

  for (const r of (info ?? []) as { applicant_id: string | null; member_id: string | null }[]) {
    if (r.applicant_id && idSet.has(r.applicant_id)) attendedInfo.add(r.applicant_id);
    if (r.member_id && idSet.has(r.member_id)) attendedInfo.add(r.member_id);
  }

  return { memById, coffeeById, completedWith, coffeeWithById, coffeeHostIdsById, attendedInfo, boardExecIds };
}

// Spreadsheet-style scan of every applicant who ranked one project in the
// selected period, with a column for the project's essay and one for each of
// its custom questions. In all-projects mode the pager steps through every
// project a page at a time. Filters/sorts client-side; Review opens the
// existing per-application modal via onReview.
export function ApplicationSheetModal({
  open,
  onOpenChange,
  periodId,
  periodName,
  periodEndsAt,
  projectId,
  projectName,
  allProjects = false,
  canEditRecruiting = false,
  onReview,
  onRecruitingChanged,
  reloadToken = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodId: string | null;
  // Only used to name the CSV export.
  periodName?: string | null;
  // The period's deadline, used to flag applications submitted after it as late.
  periodEndsAt?: string | null;
  projectId: string | null;
  projectName?: string | null;
  // Page through an all-applicants overview and then every project in the
  // period, rather than the single project the reviewer picked. Gated to
  // reviewers with full application access.
  allProjects?: boolean;
  // Board/exec can edit coffee / infosession / returning cells inline.
  canEditRecruiting?: boolean;
  onReview: (row: {
    id: string;
    name: string;
    status: ReviewStatus;
    // The page's project, so the review modal opens in that project's context.
    projectId?: string | null;
    focus?: FocusSection;
  }) => void;
  // Fired after a recruiting-field edit so the parent list can refresh.
  onRecruitingChanged?: () => void;
  // Bump after accept/reject so the sheet refreshes decision columns while open.
  reloadToken?: number;
}) {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Studio project PMs for the active page — used to refresh projectCoffee after
  // an inline coffee-chat edit without reloading the whole sheet.
  const [projectPmIds, setProjectPmIds] = useState<Set<string>>(new Set());

  // The projects this sheet can page through, and where we are in them.
  const [pageProjects, setPageProjects] = useState<PageProject[] | null>(null);
  const [projectPage, setProjectPage] = useState(0);
  // The active project's custom questions, in authoring order.
  const [questions, setQuestions] = useState<ProjectQuestion[]>([]);

  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<Set<string>>(new Set());
  const [classFilter, setClassFilter] = useState<Set<string>>(new Set());
  const [coffeeFilter, setCoffeeFilter] = useState<CoffeeFilter>("any");
  const [infoFilter, setInfoFilter] = useState<TriFilter>("any");
  const [validFilter, setValidFilter] = useState<TriFilter>("any");
  const [projectCoffeeFilter, setProjectCoffeeFilter] = useState<ProjectCoffeeFilter>("any");
  const [returningFilter, setReturningFilter] = useState<TriFilter>("any");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("any");
  // Selected options per choice question, keyed by question id. Project-scoped,
  // so it clears whenever the page turns.
  const [answerFilters, setAnswerFilters] = useState<Record<string, Set<string>>>({});
  // Selected project ids per rank slot on the overview page.
  const [slotFilters, setSlotFilters] = useState<Record<number, Set<string>>>({});
  const [sort, setSort] = useState<SortState>({ key: "rank", dir: "asc" });
  // Which column's header menu is open, so only one is ever open at a time.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menu: MenuControl = { openId: openMenu, setOpenId: setOpenMenu };
  const [page, setPage] = useState(0);
  // Pending "Drop" target in the all-projects sheet (admin reject, non-destructive).
  const [dropTarget, setDropTarget] = useState<SheetRow | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  // All-projects mode leads with the overview, then one page per project. A
  // reviewer scoped to a single project just gets that project's page.
  const pages = useMemo<SheetPage[] | null>(() => {
    if (!pageProjects) return null;
    const projectPages: SheetPage[] = pageProjects.map((project) => ({ kind: "project", project }));
    return allProjects ? [{ kind: "overview" }, ...projectPages] : projectPages;
  }, [pageProjects, allProjects]);

  const safeProjectPage = pages?.length ? Math.min(projectPage, pages.length - 1) : 0;
  const activePage = useMemo(
    () => (pages?.length ? pages[safeProjectPage] ?? null : null),
    [pages, safeProjectPage],
  );
  // Null on the overview page, which keeps every project-specific branch below
  // (studio column, essay prompt, review context) correct without extra checks.
  const activeProject = activePage?.kind === "project" ? activePage.project : null;
  const isOverview = activePage?.kind === "overview";
  const isStudio = activeProject?.type === "studio";
  const pageLabel = isOverview ? "All applicants" : activeProject?.name ?? null;

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setYearFilter(new Set());
    setClassFilter(new Set());
    setCoffeeFilter("any");
    setInfoFilter("any");
    setValidFilter("any");
    setProjectCoffeeFilter("any");
    setReturningFilter("any");
    setDecisionFilter("any");
    setSlotFilters({});
    setSort({ key: "rank", dir: "asc" });
    setOpenMenu(null);
    setProjectPage(0);
  }, [open, periodId, projectId, allProjects]);

  // The projects to page over: every project when reviewing across the org,
  // otherwise just the one the reviewer picked. Projects with no applicants
  // still get a page.
  useEffect(() => {
    if (!open || (!allProjects && !projectId)) {
      setPageProjects(null);
      return;
    }
    setPageProjects(null);
    const supabase = createClient();
    (async () => {
      let query = supabase.from("projects").select("id, name, type, essay_prompt").order("name");
      if (!allProjects && projectId) query = query.eq("id", projectId);
      const { data, error: err } = await query;
      if (err) {
        setError(err.message);
        setPageProjects([]);
        return;
      }
      setPageProjects((data ?? []) as PageProject[]);
    })();
  }, [open, projectId, allProjects]);

  // Question answers and rank slots only mean anything on their own page.
  useEffect(() => {
    setAnswerFilters({});
    setSlotFilters({});
  }, [activePage]);

  useEffect(() => {
    if (!open || !periodId || !activePage) {
      setRows(null);
      setQuestions([]);
      return;
    }
    setRows(null);
    setError(null);
    const project = activePage.kind === "project" ? activePage.project : null;
    const supabase = createClient();
    (async () => {
      // A project page pins the ranking embed to that project as an inner join,
      // so only its applicants come back, each carrying its essay and answers.
      // The overview leaves the embed a plain left join and keeps every ranking
      // instead, so applicants who ranked nothing still get a row.
      const appSelect = project
        ? `id, status, submitted_at, applicant_id, tech_classes, tech_classes_other, tech_area_rankings, portfolio_url, about_note,
           application_rankings!inner(rank, essay, application_answers(question_id, answer, answer_options))`
        : `id, status, submitted_at, applicant_id, tech_classes, tech_classes_other, tech_area_rankings, portfolio_url, about_note,
           application_rankings(rank, ranked, project:projects(id, name))`;

      let appQuery = supabase
        .from("applications")
        .select(appSelect)
        .eq("period_id", periodId)
        .in("status", ["submitted", "accepted", "rejected"]);
      if (project) {
        appQuery = appQuery
          .eq("application_rankings.ranked", true)
          .eq("application_rankings.project_id", project.id);
      }

      const [questionRes, { data: appData, error: appErr }] = await Promise.all([
        project
          ? supabase
              .from("project_questions")
              .select("id, project_id, position, type, prompt, options, required")
              .eq("project_id", project.id)
              .order("position")
          : Promise.resolve({ data: [] as unknown[] }),
        appQuery,
      ]);

      setQuestions(
        ((questionRes.data ?? []) as unknown as (Omit<ProjectQuestion, "options" | "type"> & {
          options: unknown;
          type: string;
        })[]).map((q) => ({
          ...q,
          type: q.type as QuestionType,
          options: Array.isArray(q.options) ? (q.options as string[]) : null,
        })),
      );

      if (appErr) {
        setError(appErr.message);
        setRows([]);
        return;
      }

      type RawAnswer = { question_id: string; answer: string | null; answer_options: string[] | null };
      type RawRanking = {
        rank: number;
        // Project pages only.
        essay?: string | null;
        application_answers?: RawAnswer[];
        // Overview only.
        ranked?: boolean;
        project?: RankedProject | null;
      };
      type Raw = {
        id: string;
        status: ReviewStatus;
        submitted_at: string | null;
        applicant_id: string | null;
        tech_classes: string[] | null;
        tech_classes_other: string | null;
        tech_area_rankings: Record<string, number> | null;
        portfolio_url: string | null;
        about_note: string | null;
        application_rankings: RawRanking[];
      };

      const raw = (appData ?? []) as unknown as Raw[];
      const ids = [...new Set(raw.map((r) => r.applicant_id).filter((id): id is string => !!id))];

      // A studio project gates on a completed chat with one of *its* PMs.
      const projectPms = new Set<string>();
      if (project?.type === "studio") {
        const { data: pms } = await supabase
          .from("project_members")
          .select("user_id")
          .eq("project_id", project.id)
          .eq("is_pm", true);
        for (const p of (pms ?? []) as { user_id: string }[]) projectPms.add(p.user_id);
      }
      setProjectPmIds(projectPms);

      const { memById, coffeeById, completedWith, coffeeWithById, coffeeHostIdsById, attendedInfo, boardExecIds } =
        await loadApplicantContext(supabase, ids);

      const next: SheetRow[] = raw.map((r) => {
        const aid = r.applicant_id ?? "";
        const m = memById[aid];
        const name =
          [m?.preferred_firstname, m?.lastname].filter(Boolean).join(" ") || "Applicant";
        const areaRanks = r.tech_area_rankings ?? {};
        const topAreas = Object.entries(areaRanks)
          .filter(([, v]) => typeof v === "number" && v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => techAreaLabel(k));

        const memberStatus = (m?.status as MemberStatus | null | undefined) ?? null;
        const returning = isReturningMember(memberStatus);
        const coffee = coffeeById[aid] ?? "none";
        const infosession = attendedInfo.has(aid);
        // Board/exec members and returning members are auto-valid; everyone
        // else must clear both the coffee-chat and info-session requirements.
        const boardExec = boardExecIds.has(aid);
        const valid = sheetValid({ boardExec, returning, coffee, infosession, submittedAt: r.submitted_at }, periodEndsAt);
        const met = !!project && project.type === "studio" && [...projectPms].some((pm) => completedWith[aid]?.has(pm));

        const ranking = r.application_rankings[0];
        const answers: Record<string, AnswerValue> = {};
        for (const a of ranking?.application_answers ?? []) {
          answers[a.question_id] = {
            text: (a.answer ?? "").trim(),
            options: Array.isArray(a.answer_options) ? a.answer_options : [],
          };
        }

        // Soft-removed rankings (ranked = false) keep their essay for a re-add
        // but aren't choices any more, so they don't occupy a slot.
        const slots: Record<number, RankedProject> = {};
        if (!project) {
          for (const rk of r.application_rankings) {
            if (rk.ranked === false || !rk.project) continue;
            if (rk.rank >= 1 && rk.rank <= MAX_RANK) slots[rk.rank] = rk.project;
          }
        }

        const classLabels = [
          ...(r.tech_classes ?? []).map(techClassLabel),
          ...(r.tech_classes_other?.trim() ? [r.tech_classes_other.trim()] : []),
        ];

        return {
          id: r.id,
          status: r.status,
          submittedAt: r.submitted_at,
          applicantId: aid,
          name,
          // On the overview `ranking` is just whichever ranking came back
          // first, so there's no single rank to report — leave it at 0 rather
          // than letting an arbitrary one drive the rank sort.
          rank: project ? ranking?.rank ?? 0 : 0,
          gradYear: (m?.grad_year && String(m.grad_year).trim()) || "—",
          returning,
          memberStatus,
          coffee,
          coffeeWith: coffeeWithById[aid] ?? [],
          coffeeHostIds: coffeeHostIdsById[aid] ?? [],
          projectCoffee: project?.type === "studio" ? ((met ? "met" : "missing") as "met" | "missing") : null,
          infosession,
          boardExec,
          valid,
          techClasses: r.tech_classes ?? [],
          techClassesOther: r.tech_classes_other,
          topAreas,
          portfolioUrl: r.portfolio_url,
          aboutNote: r.about_note,
          essay: ranking?.essay ?? null,
          answers,
          slots,
          // Searching the stored text rather than the rendered cell means the
          // box matches full essays and answers, not their truncated preview.
          search: [
            name,
            submittedLabel(r.submitted_at),
            m?.grad_year ?? "",
            ...classLabels,
            ...topAreas,
            r.portfolio_url ?? "",
            r.about_note ?? "",
            ranking?.essay ?? "",
            ...Object.values(answers).flatMap((a) => [a.text, ...a.options]),
            ...Object.values(slots).map((p) => p.name),
          ]
            .join(" ")
            .toLowerCase(),
        };
      });

      setRows(next);
    })();
  }, [open, periodId, activePage, reloadToken, periodEndsAt]);

  const yearOptions = useMemo(() => {
    if (!rows) return [];
    const set = new Set(rows.map((r) => r.gradYear));
    return [...set]
      .sort((a, b) => classRank(a) - classRank(b) || a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [rows]);

  const classOptions = useMemo(() => {
    const fromCanon = TECH_CLASSES.map((c) => ({ value: c.key, label: c.label }));
    if (!rows) return fromCanon;
    const hasOther = rows.some((r) => !!r.techClassesOther?.trim());
    return hasOther ? [...fromCanon, { value: "__other__", label: "Other" }] : fromCanon;
  }, [rows]);

  // Only render as many choice columns as anyone actually used, so a period
  // where nobody ranked past their 3rd choice doesn't carry four empty columns.
  const slotCount = useMemo(() => {
    if (!isOverview || !rows) return 0;
    let deepest = 0;
    for (const r of rows) {
      for (const slot of Object.keys(r.slots)) deepest = Math.max(deepest, Number(slot));
    }
    return Math.min(deepest, MAX_RANK);
  }, [isOverview, rows]);

  const slots = useMemo(() => Array.from({ length: slotCount }, (_, i) => i + 1), [slotCount]);

  // The projects that actually appear in a given slot, for that column's filter.
  const slotOptions = useMemo(() => {
    const byslot: Record<number, FilterOption[]> = {};
    if (!rows) return byslot;
    for (const slot of slots) {
      const byId = new Map<string, string>();
      for (const r of rows) {
        const p = r.slots[slot];
        if (p) byId.set(p.id, p.name);
      }
      byslot[slot] = [...byId]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label }));
    }
    return byslot;
  }, [rows, slots]);

  const toggleSet = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const toggleAnswerFilter = (questionId: string, value: string) =>
    setAnswerFilters((prev) => {
      const next = new Set(prev[questionId] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [questionId]: next };
    });

  const clearAnswerFilter = (questionId: string) =>
    setAnswerFilters((prev) => ({ ...prev, [questionId]: new Set() }));

  const toggleSlotFilter = (slot: number, value: string) =>
    setSlotFilters((prev) => {
      const next = new Set(prev[slot] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [slot]: next };
    });

  const clearSlotFilter = (slot: number) => setSlotFilters((prev) => ({ ...prev, [slot]: new Set() }));

  // The overview has no Rank column, so the default rank sort would leave the
  // rows alphabetical (rank is 0 for all of them) with no header saying so.
  // Falling back to Name keeps the indicator honest about the order shown.
  const effectiveSort = useMemo<SortState>(
    () => (isOverview && sort.key === "rank" ? { key: "name", dir: sort.dir } : sort),
    [isOverview, sort],
  );

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (needle && !r.search.includes(needle)) return false;
      if (yearFilter.size && !yearFilter.has(r.gradYear)) return false;
      if (classFilter.size) {
        const keys = new Set(r.techClasses);
        const wantsOther = classFilter.has("__other__");
        const hitCanon = [...classFilter].some((k) => k !== "__other__" && keys.has(k));
        const hitOther = wantsOther && !!r.techClassesOther?.trim();
        if (!hitCanon && !hitOther) return false;
      }
      if (coffeeFilter !== "any" && r.coffee !== coffeeFilter) return false;
      if (infoFilter === "yes" && !r.infosession) return false;
      if (infoFilter === "no" && r.infosession) return false;
      if (validFilter === "yes" && !r.valid) return false;
      if (validFilter === "no" && r.valid) return false;
      if (isStudio && projectCoffeeFilter !== "any") {
        if (r.projectCoffee !== projectCoffeeFilter) return false;
      }
      if (returningFilter === "yes" && !r.returning) return false;
      if (returningFilter === "no" && r.returning) return false;
      if (decisionFilter === "pending" && r.status !== "submitted") return false;
      if (decisionFilter === "accepted" && r.status !== "accepted") return false;
      if (decisionFilter === "rejected" && r.status !== "rejected") return false;
      // A choice question keeps the rows that picked one of the checked options.
      for (const [questionId, selected] of Object.entries(answerFilters)) {
        if (!selected.size) continue;
        const picked = r.answers[questionId]?.options ?? [];
        if (!picked.some((o) => selected.has(o))) return false;
      }
      // A slot filter keeps the rows that put one of those projects there.
      for (const [slot, selected] of Object.entries(slotFilters)) {
        if (!selected.size) continue;
        const project = r.slots[Number(slot)];
        if (!project || !selected.has(project.id)) return false;
      }
      return true;
    });

    // Ascending is the intuitive reading order per column: best rank first, A-Z,
    // Freshman first, and Yes before No for the boolean columns.
    const base = (a: SheetRow, b: SheetRow): number => {
      switch (effectiveSort.key) {
        case "rank":
          return a.rank - b.rank;
        case "name":
          return a.name.localeCompare(b.name);
        // Earliest first ascending. Every row here is submitted/accepted/
        // rejected so a null shouldn't occur, but it sorts last if one does.
        case "submitted":
          return (
            (a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity) -
            (b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity)
          );
        case "year":
          return classRank(a.gradYear) - classRank(b.gradYear) || a.gradYear.localeCompare(b.gradYear);
        case "coffee":
          return COFFEE_SORT[a.coffee] - COFFEE_SORT[b.coffee];
        case "projectCoffee":
          return Number(b.projectCoffee === "met") - Number(a.projectCoffee === "met");
        case "returning":
          return Number(b.returning) - Number(a.returning);
        case "info":
          return Number(b.infosession) - Number(a.infosession);
        case "valid":
          return Number(b.valid) - Number(a.valid);
        default:
          return 0;
      }
    };

    list = [...list].sort((a, b) => {
      const cmp = effectiveSort.dir === "asc" ? base(a, b) : -base(a, b);
      if (cmp !== 0) return cmp;
      // Within a rank, returning members first, late below on-time, invalid
      // below late — same order PMs see on the card list. Other column sorts
      // keep name as the only tiebreaker so an explicit sort stays honest.
      if (effectiveSort.key === "rank") {
        const pri = compareReviewPriority(
          { returning: a.returning, submittedAt: a.submittedAt, valid: a.valid },
          { returning: b.returning, submittedAt: b.submittedAt, valid: b.valid },
          periodEndsAt,
        );
        if (pri !== 0) return pri;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [
    rows,
    search,
    yearFilter,
    classFilter,
    coffeeFilter,
    infoFilter,
    validFilter,
    projectCoffeeFilter,
    returningFilter,
    decisionFilter,
    answerFilters,
    slotFilters,
    effectiveSort,
    isStudio,
    periodEndsAt,
  ]);

  const validCount = filtered.reduce((n, r) => n + (r.valid ? 1 : 0), 0);

  // Long lists page rather than scroll forever. The counters above still
  // describe the whole filtered set.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [
    rows,
    search,
    yearFilter,
    classFilter,
    coffeeFilter,
    infoFilter,
    validFilter,
    projectCoffeeFilter,
    returningFilter,
    decisionFilter,
    answerFilters,
    slotFilters,
    sort,
  ]);

  const openReview = (r: SheetRow, focus?: FocusSection) =>
    onReview({ id: r.id, name: r.name, status: r.status, projectId: activeProject?.id ?? null, focus });

  const anyFilterActive =
    search.trim().length > 0 ||
    yearFilter.size > 0 ||
    classFilter.size > 0 ||
    coffeeFilter !== "any" ||
    infoFilter !== "any" ||
    validFilter !== "any" ||
    projectCoffeeFilter !== "any" ||
    returningFilter !== "any" ||
    decisionFilter !== "any" ||
    Object.values(answerFilters).some((s) => s.size > 0) ||
    Object.values(slotFilters).some((s) => s.size > 0);

  const clearAllFilters = () => {
    setSearch("");
    setYearFilter(new Set());
    setClassFilter(new Set());
    setCoffeeFilter("any");
    setInfoFilter("any");
    setValidFilter("any");
    setProjectCoffeeFilter("any");
    setReturningFilter("any");
    setDecisionFilter("any");
    setAnswerFilters({});
    setSlotFilters({});
  };

  // The CSV columns, in the same order and under the same conditionals as the
  // table below. This mirrors the JSX rather than driving it, so the two lists
  // have to be kept in step when a column is added.
  const exportColumns = useMemo(() => {
    const yesNo = (v: boolean) => (v ? "Yes" : "No");
    const cols: { header: string; value: (r: SheetRow) => string }[] = [
      { header: "Name", value: (r) => r.name },
    ];
    if (!isOverview) cols.push({ header: "Rank", value: (r) => rankLabel(r.rank) });
    for (const slot of slots) {
      cols.push({ header: rankLabel(slot), value: (r) => r.slots[slot]?.name ?? "" });
    }
    cols.push(
      { header: "Year", value: (r) => (r.gradYear === "—" ? "" : r.gradYear) },
      { header: "Returning", value: (r) => yesNo(r.returning) },
      { header: "Coffee", value: (r) => COFFEE_CSV[r.coffee] },
    );
    if (isStudio) {
      cols.push({
        header: "Project coffee",
        value: (r) => (r.projectCoffee === "met" ? "Met" : r.projectCoffee === "missing" ? "Missing" : ""),
      });
    }
    cols.push(
      { header: "Info session", value: (r) => yesNo(r.infosession) },
      { header: "Valid", value: (r) => yesNo(r.valid) },
      {
        header: "Classes",
        value: (r) =>
          [
            ...r.techClasses.map(techClassLabel),
            ...(r.techClassesOther?.trim() ? [r.techClassesOther.trim()] : []),
          ].join(", "),
      },
      { header: "Tech areas", value: (r) => r.topAreas.join(", ") },
      { header: "Portfolio", value: (r) => r.portfolioUrl ?? "" },
    );
    if (isOverview) cols.push({ header: "About", value: (r) => r.aboutNote ?? "" });
    else cols.push({ header: "Essay", value: (r) => r.essay ?? "" });
    for (const q of questions) {
      cols.push({ header: q.prompt, value: (r) => answerText(r, q.id) });
    }
    cols.push(
      // The raw timestamp, so a spreadsheet parses and sorts it as a date
      // rather than as the abbreviated text the cell shows.
      { header: "Submitted", value: (r) => r.submittedAt ?? "" },
      { header: "Late", value: (r) => (isLate(r.submittedAt, periodEndsAt) ? "Yes" : "") },
      { header: "Decision", value: (r) => DECISION_CSV[r.status] },
    );
    return cols;
  }, [isOverview, isStudio, slots, questions, periodEndsAt]);

  const th = "sticky top-0 z-20 bg-background border-b border-r px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
  const td = "border-b border-r px-2 py-1.5 text-xs align-middle";
  // Essay and question prompts are full sentences. Pinning those columns to a
  // definite width is what lets the header and cell text truncate instead of
  // stretching the column, which matters once a project has many questions.
  const longCol = "w-[13rem] min-w-[13rem] max-w-[13rem]";

  const title = pageLabel ?? projectName ?? null;

  const exportCsv = () => {
    const scope = csvSlug(pageLabel ?? projectName ?? "sheet");
    const period = periodName ? `${csvSlug(periodName)}-` : "";
    downloadCsv(
      `applications-${period}${scope}`,
      exportColumns.map((c) => c.header),
      filtered.map((r) => exportColumns.map((c) => c.value(r))),
    );
  };

  const patchRow = (applicantId: string, patch: (row: SheetRow) => SheetRow) => {
    setRows((prev) =>
      prev
        ? prev.map((r) => {
            if (r.applicantId !== applicantId) return r;
            const next = patch(r);
            return { ...next, valid: sheetValid(next, periodEndsAt) };
          })
        : prev,
    );
    onRecruitingChanged?.();
  };

  // Admin-only drop from the global (all-projects) sheet. Flips status to
  // rejected via reject_application — keeps answers/data; not gated by the
  // review-modal DECISIONS_ENABLED flag.
  const handleDrop = async () => {
    if (!dropTarget) return;
    setDropError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("reject_application", {
      p_application_id: dropTarget.id,
    });
    if (err) {
      setDropError(err.message);
      return false;
    }
    patchRow(dropTarget.applicantId, (r) => ({ ...r, status: "rejected" as ReviewStatus }));
  };

  const onCoffeeSaved = (applicantId: string, next: CoffeeEditResult) => {
    patchRow(applicantId, (r) => {
      const projectCoffee =
        r.projectCoffee === null
          ? null
          : next.coffee === "none"
            ? ("missing" as const)
            : next.coffee === "done" && next.coffeeHostIds.some((id) => projectPmIds.has(id))
              ? ("met" as const)
              // Other completed chats are left in the DB; keep Met if we already had it.
              : r.projectCoffee === "met"
                ? ("met" as const)
                : ("missing" as const);
      return {
        ...r,
        coffee: next.coffee,
        coffeeWith: next.coffeeWith,
        coffeeHostIds: next.coffeeHostIds,
        projectCoffee,
      };
    });
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-[95vw] flex-col gap-3 overflow-hidden p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>
            Sheet view{title ? ` · ${title}` : ""}
            {rows ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                {filtered.length}/{rows.length} · Valid {validCount} ({pct(validCount, filtered.length)}%)
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Toolbar. The pager (all-applicants overview, then one page per
            project) sits outside the table so an empty page doesn't strand the
            reviewer with no way forward. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {allProjects && pages && pages.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={safeProjectPage === 0}
                onClick={() => setProjectPage(safeProjectPage - 1)}
              >
                <ChevronLeft size={13} className="mr-1" />
                Previous
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-accent transition-colors">
                    <span className="font-medium">{pageLabel ?? "Select page"}</span>
                    <ChevronDown size={12} className="text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72">
                  {pages.map((p, i) => (
                    <DropdownMenuItem
                      key={p.kind === "overview" ? "__overview__" : p.project.id}
                      className="text-xs"
                      onSelect={() => setProjectPage(i)}
                    >
                      {p.kind === "overview" ? "All applicants" : p.project.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={safeProjectPage >= pages.length - 1}
                onClick={() => setProjectPage(safeProjectPage + 1)}
              >
                Next
                <ChevronRight size={13} className="ml-1" />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {safeProjectPage + 1} / {pages.length}
              </span>
            </>
          )}

          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, answers…"
              className="h-7 w-56 pl-7 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={filtered.length === 0}
            onClick={exportCsv}
            title="Download the rows below, with full essay and answer text"
          >
            <Download size={13} className="mr-1" />
            Export CSV
          </Button>
        </div>

        {pages?.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-muted-foreground">No projects to review.</p>
          </div>
        ) : rows === null ? (
          <div className="flex-1 min-h-[20rem] rounded-lg border bg-muted animate-pulse" />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-muted-foreground">
              {rows.length > 0
                ? "No applicants match these filters."
                : isOverview
                  ? "No applications in this period yet."
                  : "No applicants ranked this project."}
            </p>
            {anyFilterActive && (
              <Button variant="outline" size="sm" onClick={clearAllFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <ScrollArea orientation="both" className="min-h-0 flex-1 border rounded-lg">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, "left-0 z-30 min-w-[10rem]")}>
                    <HeaderMenu label="Name" columnKey="name" sort={effectiveSort} onSort={setSort} menu={menu} />
                  </th>
                  {!isOverview && (
                    <th className={th}>
                      <HeaderMenu label="Rank" columnKey="rank" sort={effectiveSort} onSort={setSort} menu={menu} />
                    </th>
                  )}
                  {/* Overview: which project the applicant put in each slot.
                      Filter-only, like Classes — there's no meaningful order to
                      sort a column of project names by. */}
                  {slots.map((slot) => (
                    <th key={slot} className={cn(th, "min-w-[10rem] max-w-[12rem]")}>
                      <HeaderMenu
                        label={rankLabel(slot)}
                        menuId={`slot:${slot}`}
                        sort={effectiveSort}
                        onSort={setSort}
                        menu={menu}
                        active={(slotFilters[slot]?.size ?? 0) > 0}
                        onClear={() => clearSlotFilter(slot)}
                      >
                        <CheckFilter
                          options={slotOptions[slot] ?? []}
                          selected={slotFilters[slot] ?? NO_SELECTION}
                          onToggle={(v) => toggleSlotFilter(slot, v)}
                        />
                      </HeaderMenu>
                    </th>
                  ))}
                  <th className={th}>
                    <HeaderMenu
                      label="Year"
                      columnKey="year"
                      sort={effectiveSort}
                      onSort={setSort}
                      menu={menu}
                      active={yearFilter.size > 0}
                      onClear={() => setYearFilter(new Set())}
                    >
                      <CheckFilter
                        options={yearOptions}
                        selected={yearFilter}
                        onToggle={(v) => toggleSet(yearFilter, v, setYearFilter)}
                      />
                    </HeaderMenu>
                  </th>
                  <th className={th}>
                    <HeaderMenu
                      label="Returning"
                      columnKey="returning"
                      sort={effectiveSort}
                      onSort={setSort}
                      menu={menu}
                      active={returningFilter !== "any"}
                      onClear={() => setReturningFilter("any")}
                    >
                      <RadioFilter
                        value={returningFilter}
                        options={YES_NO}
                        onChange={(v) => setReturningFilter(v as TriFilter)}
                      />
                    </HeaderMenu>
                  </th>
                  <th className={th}>
                    <HeaderMenu
                      label="Coffee"
                      columnKey="coffee"
                      sort={effectiveSort}
                      onSort={setSort}
                      menu={menu}
                      active={coffeeFilter !== "any"}
                      onClear={() => setCoffeeFilter("any")}
                    >
                      <RadioFilter
                        value={coffeeFilter}
                        options={[
                          { value: "any", label: "Any" },
                          { value: "done", label: "Done" },
                          { value: "booked", label: "Booked" },
                          { value: "none", label: "None" },
                        ]}
                        onChange={(v) => setCoffeeFilter(v as CoffeeFilter)}
                      />
                    </HeaderMenu>
                  </th>
                  {isStudio && (
                    <th className={th}>
                      <HeaderMenu
                        label="Project coffee"
                        columnKey="projectCoffee"
                        sort={effectiveSort}
                        onSort={setSort}
                        menu={menu}
                        active={projectCoffeeFilter !== "any"}
                        onClear={() => setProjectCoffeeFilter("any")}
                        title="Completed a coffee chat with one of this project's PMs"
                      >
                        <RadioFilter
                          value={projectCoffeeFilter}
                          options={[
                            { value: "any", label: "Any" },
                            { value: "met", label: "Met" },
                            { value: "missing", label: "Missing" },
                          ]}
                          onChange={(v) => setProjectCoffeeFilter(v as ProjectCoffeeFilter)}
                        />
                      </HeaderMenu>
                    </th>
                  )}
                  <th className={th}>
                    <HeaderMenu
                      label="Info"
                      columnKey="info"
                      sort={effectiveSort}
                      onSort={setSort}
                      menu={menu}
                      active={infoFilter !== "any"}
                      onClear={() => setInfoFilter("any")}
                    >
                      <RadioFilter
                        value={infoFilter}
                        options={YES_NO}
                        onChange={(v) => setInfoFilter(v as TriFilter)}
                      />
                    </HeaderMenu>
                  </th>
                  <th className={th}>
                    <HeaderMenu
                      label="Valid"
                      columnKey="valid"
                      sort={effectiveSort}
                      onSort={setSort}
                      menu={menu}
                      active={validFilter !== "any"}
                      onClear={() => setValidFilter("any")}
                      title="Coffee chat done or returning, and attended an info session"
                    >
                      <RadioFilter
                        value={validFilter}
                        options={YES_NO}
                        onChange={(v) => setValidFilter(v as TriFilter)}
                      />
                    </HeaderMenu>
                  </th>
                  <th className={cn(th, "min-w-[10rem]")}>
                    <HeaderMenu
                      label="Classes"
                      sort={effectiveSort}
                      onSort={setSort}
                      menu={menu}
                      active={classFilter.size > 0}
                      onClear={() => setClassFilter(new Set())}
                    >
                      <CheckFilter
                        options={classOptions}
                        selected={classFilter}
                        onToggle={(v) => toggleSet(classFilter, v, setClassFilter)}
                      />
                    </HeaderMenu>
                  </th>
                  <th className={cn(th, "min-w-[10rem]")}>Tech areas</th>
                  <th className={th}>Portfolio</th>
                  {isOverview && (
                    <th className={cn(th, longCol)}>
                      <span className="block truncate">About</span>
                    </th>
                  )}
                  {!isOverview && (
                    <th className={cn(th, longCol)} title={activeProject?.essay_prompt ?? undefined}>
                      <span className="block truncate">Essay</span>
                    </th>
                  )}
                  {/* One column per custom question on the page's project. */}
                  {questions.map((q) => (
                    <th key={q.id} className={cn(th, longCol)}>
                      {isChoiceType(q.type) ? (
                        <HeaderMenu
                          label={q.prompt}
                          menuId={q.id}
                          title={q.prompt}
                          sort={effectiveSort}
                          onSort={setSort}
                          menu={menu}
                          active={(answerFilters[q.id]?.size ?? 0) > 0}
                          onClear={() => clearAnswerFilter(q.id)}
                        >
                          <CheckFilter
                            options={(q.options ?? []).map((o) => ({ value: o, label: o }))}
                            selected={answerFilters[q.id] ?? NO_SELECTION}
                            onToggle={(v) => toggleAnswerFilter(q.id, v)}
                          />
                        </HeaderMenu>
                      ) : (
                        <span className="block truncate" title={q.prompt}>
                          {q.prompt}
                        </span>
                      )}
                    </th>
                  ))}
                  <th className={th}>
                    <HeaderMenu label="Submitted" columnKey="submitted" sort={effectiveSort} onSort={setSort} menu={menu} />
                  </th>
                  <th className={th}>
                    <HeaderMenu
                      label="Decision"
                      sort={effectiveSort}
                      onSort={setSort}
                      menu={menu}
                      active={decisionFilter !== "any"}
                      onClear={() => setDecisionFilter("any")}
                    >
                      <RadioFilter
                        value={decisionFilter}
                        options={[
                          { value: "any", label: "Any" },
                          { value: "pending", label: "Pending" },
                          { value: "accepted", label: "Accepted" },
                          { value: "rejected", label: "Rejected" },
                        ]}
                        onChange={(v) => setDecisionFilter(v as DecisionFilter)}
                      />
                    </HeaderMenu>
                  </th>
                  <th className={cn(th, !allProjects && "border-r-0")}> </th>
                  {allProjects && <th className={cn(th, "border-r-0")}> </th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const classLabels = [
                    ...r.techClasses.map(techClassLabel),
                    ...(r.techClassesOther?.trim() ? [r.techClassesOther.trim()] : []),
                  ];
                  return (
                    <tr key={r.id} className="hover:bg-accent/40">
                      <td className={cn(td, "sticky left-0 z-10 bg-background min-w-[10rem]")}>
                        <PersonName userId={r.applicantId || undefined} name={r.name} className="block truncate font-medium" />
                      </td>
                      {!isOverview && (
                        <td className={cn(td, "whitespace-nowrap tabular-nums")}>{rankLabel(r.rank)}</td>
                      )}
                      {slots.map((slot) => {
                        const choice = r.slots[slot];
                        return (
                          <td key={slot} className={cn(td, "max-w-[12rem]")} title={choice?.name}>
                            {choice ? (
                              // Doubles as a jump table: open the review modal
                              // already scrolled to that project's answers.
                              <button
                                type="button"
                                className="block w-full truncate text-left hover:underline"
                                onClick={() =>
                                  onReview({
                                    id: r.id,
                                    name: r.name,
                                    status: r.status,
                                    projectId: choice.id,
                                    focus: "essay",
                                  })
                                }
                              >
                                {choice.name}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={cn(td, "whitespace-nowrap")}>{r.gradYear}</td>
                      <td className={td}>
                        {canEditRecruiting && r.applicantId ? (
                          <SheetReturningCell
                            applicantId={r.applicantId}
                            returning={r.returning}
                            memberStatus={r.memberStatus}
                            onSaved={(returning, memberStatus) =>
                              patchRow(r.applicantId, (row) => ({ ...row, returning, memberStatus }))
                            }
                          />
                        ) : r.returning ? (
                          <span className="text-indigo-600">Yes</span>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className={td}>
                        {canEditRecruiting && r.applicantId ? (
                          <SheetCoffeeCell
                            applicantId={r.applicantId}
                            state={r.coffee}
                            withNames={r.coffeeWith}
                            hostIds={r.coffeeHostIds}
                            onSaved={(next) => onCoffeeSaved(r.applicantId, next)}
                          />
                        ) : r.coffee === "none" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <CoffeeChatIndicator state={r.coffee} withNames={r.coffeeWith} />
                        )}
                      </td>
                      {isStudio && (
                        <td className={td}>
                          {r.projectCoffee === null ? (
                            // Launch project: no PM chat requirement to report.
                            <span className="text-muted-foreground">—</span>
                          ) : r.projectCoffee === "met" ? (
                            <span className="inline-flex items-center gap-0.5 text-green-600" title="Completed coffee with a project PM">
                              <Check size={14} className="stroke-[3]" /> Met
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-muted-foreground" title="No completed coffee with a project PM">
                              <X size={14} /> Missing
                            </span>
                          )}
                        </td>
                      )}
                      <td className={td}>
                        {canEditRecruiting && r.applicantId ? (
                          <SheetInfosessionCell
                            applicantId={r.applicantId}
                            attended={r.infosession}
                            onSaved={(infosession) =>
                              patchRow(r.applicantId, (row) => ({ ...row, infosession }))
                            }
                          />
                        ) : r.infosession ? (
                          <InfosessionIndicator attended />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.valid ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-green-600"
                            title="Board/exec, or: coffee chat done or returning, and attended an info session"
                          >
                            <Check size={14} className="stroke-[3]" /> Valid
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={cn(td, "max-w-[12rem]")} title={classLabels.join(", ")}>
                        {classLabels.length ? (
                          <button
                            type="button"
                            className="block w-full truncate text-left hover:underline"
                            onClick={() => openReview(r, "classes")}
                          >
                            {classLabels.join(", ")}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={cn(td, "max-w-[12rem]")} title={r.topAreas.join(", ")}>
                        {r.topAreas.length ? (
                          <button
                            type="button"
                            className="block w-full truncate text-left hover:underline"
                            onClick={() => openReview(r, "areas")}
                          >
                            {r.topAreas.join(", ")}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.portfolioUrl ? (
                          <a
                            href={r.portfolioUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-600 hover:underline"
                          >
                            Link
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {isOverview && (
                        <td className={cn(td, longCol)} title={r.aboutNote ?? undefined}>
                          {r.aboutNote?.trim() ? (
                            <button
                              type="button"
                              className="block w-full truncate text-left hover:underline"
                              onClick={() => openReview(r)}
                            >
                              {r.aboutNote.trim()}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      {!isOverview && (
                        <td className={cn(td, longCol)} title={r.essay ?? undefined}>
                          {r.essay?.trim() ? (
                            <button
                              type="button"
                              className="block w-full truncate text-left hover:underline"
                              onClick={() => openReview(r, "essay")}
                            >
                              {r.essay.trim()}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      {questions.map((q) => {
                        const value = answerText(r, q.id);
                        return (
                          <td key={q.id} className={cn(td, longCol)} title={value || undefined}>
                            {value ? (
                              <button
                                type="button"
                                className="block w-full truncate text-left hover:underline"
                                onClick={() => openReview(r, "essay")}
                              >
                                {value}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td
                        className={cn(td, "whitespace-nowrap text-muted-foreground")}
                        title={r.submittedAt ? new Date(r.submittedAt).toLocaleString() : undefined}
                      >
                        {r.submittedAt ? submittedLabel(r.submittedAt) : "—"}
                        <LateBadge
                          submittedAt={r.submittedAt}
                          endsAt={periodEndsAt}
                          className="ml-1.5 text-[0.6rem] px-1 py-0"
                        />
                      </td>
                      <td className={td}>
                        {r.status === "accepted" ? (
                          <Badge className="bg-green-600 hover:bg-green-600 text-[0.65rem] px-1.5 py-0">Accepted</Badge>
                        ) : r.status === "rejected" ? (
                          <Badge variant="destructive" className="text-[0.65rem] px-1.5 py-0">Rejected</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={cn(td, !allProjects && "border-r-0")}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[0.7rem]"
                          onClick={() => openReview(r)}
                        >
                          Review
                        </Button>
                      </td>
                      {allProjects && (
                        <td className={cn(td, "border-r-0")}>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 px-2 text-[0.7rem]"
                            disabled={r.status === "rejected"}
                            title={r.status === "rejected" ? "Already dropped" : undefined}
                            onClick={() => setDropTarget(r)}
                          >
                            Drop
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}

        {rows && filtered.length > PAGE_SIZE && (
          <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              Showing {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + pageRows.length} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </Button>
              <span className="tabular-nums">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={!!dropTarget}
      onOpenChange={(o) => {
        if (!o) {
          setDropTarget(null);
          setDropError(null);
        }
      }}
      title={`Drop ${dropTarget?.name ?? "this applicant"}'s application?`}
      description={
        <>
          This marks the application as rejected and clears any project placement.
          Their submitted answers and data are kept — nothing is deleted.
          {dropError && <span className="mt-2 block text-red-500">{dropError}</span>}
        </>
      }
      confirmLabel="Drop application"
      destructive
      onConfirm={handleDrop}
    />
    </>
  );
}
