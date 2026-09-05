"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Check, X, ArrowUp, ArrowDown } from "lucide-react";
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
import { ScrollArea } from "@/components/overlay-scrollbar";
import { PersonName } from "@/components/person-profile-provider";
import { CoffeeChatIndicator, InfosessionIndicator, type CoffeeState } from "@/components/applicant-indicators";
import { type FocusSection, type ReviewStatus } from "@/components/application-review-modal";
import { pct } from "@/components/donut-chart";
import { rankLabel } from "@/lib/application-rank";
import {
  TECH_CLASSES,
  techAreaLabel,
  techClassLabel,
} from "@/lib/application-profile";
import { cn } from "@/lib/utils";

type SheetRow = {
  id: string;
  status: ReviewStatus;
  applicantId: string;
  name: string;
  projectId: string;
  projectName: string;
  rank: number;
  gradYear: string;
  returning: boolean;
  coffee: CoffeeState;
  projectCoffee: "met" | "missing" | null; // null = not a studio project
  infosession: boolean;
  // Cleared both recruiting requirements: completed a coffee chat (or exempt as
  // a returning member) and attended an info session. Mirrors both_valid (0063).
  valid: boolean;
  techClasses: string[];
  techClassesOther: string | null;
  topAreas: string[];
  portfolioUrl: string | null;
  essay: string | null;
};

type TriFilter = "any" | "yes" | "no";
type CoffeeFilter = "any" | CoffeeState;
type ProjectCoffeeFilter = "any" | "met" | "missing";
type DecisionFilter = "any" | "pending" | "accepted" | "rejected";
type SortKey =
  | "rank"
  | "name"
  | "project"
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

const PAGE_SIZE = 50;

// Each header menu is its own Radix root, so they don't know about each other.
// The sheet owns which column's menu is open (keyed on the column label, unique
// per table) so opening one closes any other — never two at once.
type MenuControl = {
  openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
};

// Column header that doubles as its own sort/filter control: clicking the label
// opens a menu with the sort directions (when the column is sortable) and that
// column's filter. `active` marks a column whose filter is narrowing the rows.
function HeaderMenu({
  label,
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
  const sorted = !!columnKey && sort.key === columnKey;
  const { openId, setOpenId } = menu;
  return (
    <DropdownMenu
      open={openId === label}
      onOpenChange={(o) => setOpenId((cur) => (o ? label : cur === label ? null : cur))}
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
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
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

// Spreadsheet-style scan of every applicant who ranked the selected project in
// the selected period. Filters/sorts client-side; Review opens the existing
// per-application modal via onReview.
export function ApplicationSheetModal({
  open,
  onOpenChange,
  periodId,
  projectId,
  projectName,
  allProjects = false,
  onReview,
  reloadToken = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodId: string | null;
  projectId: string | null;
  projectName?: string | null;
  // Every applicant in the period across every project they ranked, one row per
  // (applicant, project). Gated to reviewers with full application access.
  allProjects?: boolean;
  onReview: (row: {
    id: string;
    name: string;
    status: ReviewStatus;
    // The row's project, so the review modal opens in that project's context
    // (matters in all-projects mode, where rows span projects).
    projectId?: string | null;
    focus?: FocusSection;
  }) => void;
  // Bump after accept/reject so the sheet refreshes decision columns while open.
  reloadToken?: number;
}) {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStudio, setIsStudio] = useState(false);

  const [yearFilter, setYearFilter] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [classFilter, setClassFilter] = useState<Set<string>>(new Set());
  const [coffeeFilter, setCoffeeFilter] = useState<CoffeeFilter>("any");
  const [infoFilter, setInfoFilter] = useState<TriFilter>("any");
  const [validFilter, setValidFilter] = useState<TriFilter>("any");
  const [projectCoffeeFilter, setProjectCoffeeFilter] = useState<ProjectCoffeeFilter>("any");
  const [returningFilter, setReturningFilter] = useState<TriFilter>("any");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("any");
  const [sort, setSort] = useState<SortState>({ key: "rank", dir: "asc" });
  // Which column's header menu is open, so only one is ever open at a time.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menu: MenuControl = { openId: openMenu, setOpenId: setOpenMenu };
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!open) return;
    setYearFilter(new Set());
    setProjectFilter(new Set());
    setClassFilter(new Set());
    setCoffeeFilter("any");
    setInfoFilter("any");
    setValidFilter("any");
    setProjectCoffeeFilter("any");
    setReturningFilter("any");
    setDecisionFilter("any");
    setSort({ key: "rank", dir: "asc" });
    setOpenMenu(null);
  }, [open, periodId, projectId, allProjects]);

  useEffect(() => {
    if (!open || !periodId || (!projectId && !allProjects)) {
      setRows(null);
      return;
    }
    setRows(null);
    setError(null);
    const supabase = createClient();
    (async () => {
      // In all-projects mode the ranking embed stays an inner join but isn't
      // pinned to one project, so an application comes back with every ranked
      // project — one sheet row per (applicant, project).
      let appQuery = supabase
        .from("applications")
        .select(
          `id, status, applicant_id, tech_classes, tech_classes_other, tech_area_rankings, portfolio_url,
           application_rankings!inner(rank, essay, project:projects(id, name, type))`,
        )
        .eq("period_id", periodId)
        .in("status", ["submitted", "accepted", "rejected"])
        .eq("application_rankings.ranked", true);
      if (!allProjects && projectId) {
        appQuery = appQuery.eq("application_rankings.project_id", projectId);
      }

      const { data: appData, error: appErr } = await appQuery;

      if (appErr) {
        setError(appErr.message);
        setRows([]);
        return;
      }

      type RawRanking = {
        rank: number;
        essay: string | null;
        project: { id: string; name: string; type: string } | null;
      };
      type Raw = {
        id: string;
        status: ReviewStatus;
        applicant_id: string | null;
        tech_classes: string[] | null;
        tech_classes_other: string | null;
        tech_area_rankings: Record<string, number> | null;
        portfolio_url: string | null;
        application_rankings: RawRanking[];
      };

      const raw = (appData ?? []) as unknown as Raw[];
      const ids = [...new Set(raw.map((r) => r.applicant_id).filter((id): id is string => !!id))];

      // Studio projects gate on a completed chat with one of *their* PMs, so keep
      // the PM roster per project rather than a single flat list.
      const studioProjects = new Set<string>();
      for (const r of raw) {
        for (const rk of r.application_rankings) {
          if (rk.project?.type === "studio") studioProjects.add(rk.project.id);
        }
      }
      const pmsByProject: Record<string, Set<string>> = {};
      if (studioProjects.size) {
        const { data: pms } = await supabase
          .from("project_members")
          .select("project_id, user_id")
          .in("project_id", [...studioProjects])
          .eq("is_pm", true);
        for (const p of (pms ?? []) as { project_id: string; user_id: string }[]) {
          (pmsByProject[p.project_id] ??= new Set()).add(p.user_id);
        }
      }
      setIsStudio(studioProjects.size > 0);

      const memById: Record<
        string,
        { preferred_firstname: string | null; lastname: string | null; status: string | null; grad_year: string | null }
      > = {};
      const coffeeById: Record<string, CoffeeState> = {};
      // applicant -> members they've completed a chat with, for the per-project check.
      const completedWith: Record<string, Set<string>> = {};
      const attendedInfo = new Set<string>();

      if (ids.length) {
        const idSet = new Set(ids);
        const [{ data: mem }, { data: chats }, { data: info }] = await Promise.all([
          supabase
            .from("members")
            .select("user_id, preferred_firstname, lastname, status, grad_year")
            .in("user_id", ids),
          supabase.from("coffee_chats").select("applicant_id, member_id, complete").in("applicant_id", ids),
          supabase
            .from("infosesh_attendance")
            .select("applicant_id, member_id")
            .or(`applicant_id.in.(${ids.join(",")}),member_id.in.(${ids.join(",")})`),
        ]);

        for (const m of (mem ?? []) as {
          user_id: string;
          preferred_firstname: string | null;
          lastname: string | null;
          status: string | null;
          grad_year: string | null;
        }[]) {
          memById[m.user_id] = m;
        }

        for (const ch of (chats ?? []) as { applicant_id: string; member_id: string; complete: boolean }[]) {
          if (ch.complete) coffeeById[ch.applicant_id] = "done";
          else if (coffeeById[ch.applicant_id] !== "done") coffeeById[ch.applicant_id] = "booked";
          if (ch.complete) (completedWith[ch.applicant_id] ??= new Set()).add(ch.member_id);
        }

        for (const r of (info ?? []) as { applicant_id: string | null; member_id: string | null }[]) {
          if (r.applicant_id && idSet.has(r.applicant_id)) attendedInfo.add(r.applicant_id);
          if (r.member_id && idSet.has(r.member_id)) attendedInfo.add(r.member_id);
        }
      }

      const next: SheetRow[] = raw.flatMap((r) => {
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

        const returning = m?.status === "active" || m?.status === "inactive";
        const coffee = coffeeById[aid] ?? "none";
        const infosession = attendedInfo.has(aid);
        const valid = (coffee === "done" || returning) && infosession;

        return r.application_rankings.map((rk) => {
          const proj = rk.project;
          const isStudioProj = proj?.type === "studio";
          const met =
            isStudioProj && proj
              ? [...(pmsByProject[proj.id] ?? [])].some((pm) => completedWith[aid]?.has(pm))
              : false;

          return {
            id: r.id,
            status: r.status,
            applicantId: aid,
            name,
            projectId: proj?.id ?? "",
            projectName: proj?.name ?? "Unknown project",
            rank: rk.rank,
            gradYear: (m?.grad_year && String(m.grad_year).trim()) || "—",
            returning,
            coffee,
            projectCoffee: isStudioProj ? ((met ? "met" : "missing") as "met" | "missing") : null,
            infosession,
            valid,
            techClasses: r.tech_classes ?? [],
            techClassesOther: r.tech_classes_other,
            topAreas,
            portfolioUrl: r.portfolio_url,
            essay: rk.essay,
          };
        });
      });

      setRows(next);
    })();
  }, [open, periodId, projectId, allProjects, reloadToken]);

  const yearOptions = useMemo(() => {
    if (!rows) return [];
    const set = new Set(rows.map((r) => r.gradYear));
    return [...set]
      .sort((a, b) => classRank(a) - classRank(b) || a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [rows]);

  const projectOptions = useMemo(() => {
    if (!rows) return [];
    const byId = new Map(rows.map((r) => [r.projectId, r.projectName]));
    return [...byId]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const classOptions = useMemo(() => {
    const fromCanon = TECH_CLASSES.map((c) => ({ value: c.key, label: c.label }));
    if (!rows) return fromCanon;
    const hasOther = rows.some((r) => !!r.techClassesOther?.trim());
    return hasOther ? [...fromCanon, { value: "__other__", label: "Other" }] : fromCanon;
  }, [rows]);

  const toggleSet = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = rows.filter((r) => {
      if (yearFilter.size && !yearFilter.has(r.gradYear)) return false;
      if (allProjects && projectFilter.size && !projectFilter.has(r.projectId)) return false;
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
      return true;
    });

    // Ascending is the intuitive reading order per column: best rank first, A-Z,
    // Freshman first, and Yes before No for the boolean columns.
    const base = (a: SheetRow, b: SheetRow): number => {
      switch (sort.key) {
        case "rank":
          return a.rank - b.rank;
        case "name":
          return a.name.localeCompare(b.name);
        case "project":
          return a.projectName.localeCompare(b.projectName);
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
      const cmp = sort.dir === "asc" ? base(a, b) : -base(a, b);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
    return list;
  }, [
    rows,
    yearFilter,
    projectFilter,
    classFilter,
    coffeeFilter,
    infoFilter,
    validFilter,
    projectCoffeeFilter,
    returningFilter,
    decisionFilter,
    sort,
    isStudio,
    allProjects,
  ]);

  const validCount = filtered.reduce((n, r) => n + (r.valid ? 1 : 0), 0);

  // Long lists (and every all-projects list) page rather than scroll forever.
  // The counters above still describe the whole filtered set.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [
    rows,
    yearFilter,
    projectFilter,
    classFilter,
    coffeeFilter,
    infoFilter,
    validFilter,
    projectCoffeeFilter,
    returningFilter,
    decisionFilter,
    sort,
  ]);

  const openReview = (r: SheetRow, focus?: FocusSection) =>
    onReview({ id: r.id, name: r.name, status: r.status, projectId: r.projectId, focus });

  const anyFilterActive =
    yearFilter.size > 0 ||
    projectFilter.size > 0 ||
    classFilter.size > 0 ||
    coffeeFilter !== "any" ||
    infoFilter !== "any" ||
    validFilter !== "any" ||
    projectCoffeeFilter !== "any" ||
    returningFilter !== "any" ||
    decisionFilter !== "any";

  const clearAllFilters = () => {
    setYearFilter(new Set());
    setProjectFilter(new Set());
    setClassFilter(new Set());
    setCoffeeFilter("any");
    setInfoFilter("any");
    setValidFilter("any");
    setProjectCoffeeFilter("any");
    setReturningFilter("any");
    setDecisionFilter("any");
  };

  const th = "sticky top-0 z-20 bg-background border-b border-r px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
  const td = "border-b border-r px-2 py-1.5 text-xs align-middle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-[95vw] flex-col gap-3 overflow-hidden p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>
            Sheet view{allProjects ? " · All projects" : projectName ? ` · ${projectName}` : ""}
            {rows ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                {filtered.length}/{rows.length} · Valid {validCount} ({pct(validCount, filtered.length)}%)
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {rows === null ? (
          <div className="flex-1 min-h-[20rem] rounded-lg border bg-muted animate-pulse" />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-muted-foreground">No applicants match these filters.</p>
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
                    <HeaderMenu label="Name" columnKey="name" sort={sort} onSort={setSort} menu={menu} />
                  </th>
                  {allProjects && (
                    <th className={cn(th, "min-w-[10rem]")}>
                      <HeaderMenu
                        label="Project"
                        columnKey="project"
                        sort={sort}
                        onSort={setSort}
                        menu={menu}
                        active={projectFilter.size > 0}
                        onClear={() => setProjectFilter(new Set())}
                      >
                        <CheckFilter
                          options={projectOptions}
                          selected={projectFilter}
                          onToggle={(v) => toggleSet(projectFilter, v, setProjectFilter)}
                        />
                      </HeaderMenu>
                    </th>
                  )}
                  <th className={th}>
                    <HeaderMenu label="Rank" columnKey="rank" sort={sort} onSort={setSort} menu={menu} />
                  </th>
                  <th className={th}>
                    <HeaderMenu
                      label="Year"
                      columnKey="year"
                      sort={sort}
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
                      sort={sort}
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
                      sort={sort}
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
                        sort={sort}
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
                      sort={sort}
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
                      sort={sort}
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
                      sort={sort}
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
                  <th className={cn(th, "w-full min-w-[14rem]")}>Essay</th>
                  <th className={th}>
                    <HeaderMenu
                      label="Decision"
                      sort={sort}
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
                  <th className={cn(th, "border-r-0")}> </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const classLabels = [
                    ...r.techClasses.map(techClassLabel),
                    ...(r.techClassesOther?.trim() ? [r.techClassesOther.trim()] : []),
                  ];
                  return (
                    <tr key={`${r.id}:${r.projectId}`} className="hover:bg-accent/40">
                      <td className={cn(td, "sticky left-0 z-10 bg-background min-w-[10rem]")}>
                        <PersonName userId={r.applicantId || undefined} name={r.name} className="block truncate font-medium" />
                      </td>
                      {allProjects && (
                        <td className={cn(td, "min-w-[10rem] max-w-[14rem] truncate")} title={r.projectName}>
                          {r.projectName}
                        </td>
                      )}
                      <td className={cn(td, "whitespace-nowrap tabular-nums")}>{rankLabel(r.rank)}</td>
                      <td className={cn(td, "whitespace-nowrap")}>{r.gradYear}</td>
                      <td className={td}>
                        {r.returning ? (
                          <span className="text-indigo-600">Yes</span>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.coffee === "none" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <CoffeeChatIndicator state={r.coffee} />
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
                        {r.infosession ? (
                          <InfosessionIndicator attended />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.valid ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-green-600"
                            title="Coffee chat done or returning, and attended an info session"
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
                      <td className={cn(td, "max-w-[16rem]")} title={r.essay ?? undefined}>
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
                      <td className={td}>
                        {r.status === "accepted" ? (
                          <Badge className="bg-green-600 hover:bg-green-600 text-[0.65rem] px-1.5 py-0">Accepted</Badge>
                        ) : r.status === "rejected" ? (
                          <Badge variant="destructive" className="text-[0.65rem] px-1.5 py-0">Rejected</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={cn(td, "border-r-0")}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[0.7rem]"
                          onClick={() => openReview(r)}
                        >
                          Review
                        </Button>
                      </td>
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
  );
}
