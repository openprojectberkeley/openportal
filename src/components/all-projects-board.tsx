"use client";

// The cross-project board behind ?project=all on the applications manager: one
// column per project, scrolled horizontally, showing who the draft picked for
// it -- newly drafted people only, not the existing roster, no round breakdown,
// and staged/confirmed in a single list.
//
// This is also where drafting is finished, so it is no longer read-only: each
// card carries a hover menu that sets the applicant's outcome (Drafted /
// Accepted / Rejected) or moves them to another project, and each column ends
// in an add-member card. All three go through the exec-only RPCs from
// migration 0091 -- RLS makes a client-side move impossible by design (no
// UPDATE policy on draft_picks, DELETE only while a round is unsubmitted).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Plus, Table2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { ProjectIcon } from "@/components/project-icon";
import { StaticApplicantCard, type AppRow } from "@/components/applicant-meta";
import { ApplicantPickerDialog } from "@/components/applicant-picker-dialog";
import { ApplicationListSkeleton } from "@/components/skeletons";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_ACCENT, accentStyle, readableTextColor } from "@/lib/portal-color";
import {
  useAllProjectsBoard,
  usePeriodApplicants,
  type BoardCard,
  type BoardColumn,
  type BoardProject,
} from "@/lib/use-all-projects-board";

// The three states the per-card menu cycles between. "drafted" is the default:
// picked, but nobody has decided their outcome yet.
type Outcome = "drafted" | "accepted" | "rejected";

const OUTCOME_LABEL: Record<Outcome, string> = {
  drafted: "Drafted",
  accepted: "Accepted",
  rejected: "Rejected",
};

function outcomeOf(card: BoardCard, projectId: string): Outcome {
  if (card.app.status === "rejected") return "rejected";
  if (card.app.status === "accepted" && card.acceptedProjectId === projectId) return "accepted";
  return "drafted";
}

// Clicks inside the card must not reach the card root, whose onClick opens the
// review modal -- same helper the card's own overlay buttons use.
const stopClick = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
};

// The hover menu itself. Lives in the card's overlay slot, so it takes no
// layout width and rides the same gradient veil as the card's other actions.
function CardMenu({
  card,
  project,
  moveTargets,
  busy,
  onOutcome,
  onMove,
}: {
  card: BoardCard;
  project: BoardProject;
  moveTargets: BoardProject[];
  busy: boolean;
  onOutcome: (outcome: Outcome) => void;
  onMove: (toProjectId: string) => void;
}) {
  const outcome = outcomeOf(card, project.id);
  // Accepted, but onto some other project: the card's own green "Accepted"
  // badge is the application's global status, while this column's outcome is
  // still just "Drafted". Say so on the chip rather than letting the two read
  // as a contradiction.
  const elsewhere = card.app.status === "accepted" && card.acceptedProjectId !== project.id;
  return (
    <div {...stopClick} className="shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={busy}>
          <Badge
            variant={outcome === "drafted" ? "outline" : undefined}
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1 ${
              outcome === "accepted" ? "bg-green-600 hover:bg-green-600"
              : outcome === "rejected" ? "bg-destructive hover:bg-destructive"
              : ""
            } ${busy ? "opacity-50" : ""}`}
            title={elsewhere ? "Accepted onto another project" : `Outcome: ${OUTCOME_LABEL[outcome]}`}
          >
            <ChevronDown size={12} className="opacity-70" />
            {OUTCOME_LABEL[outcome]}
          </Badge>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72">
          {(["drafted", "accepted", "rejected"] as Outcome[]).map((value) => (
            <DropdownMenuItem key={value} onSelect={() => onOutcome(value)}>
              {outcome === value ? <Check size={14} className="mr-2" /> : <span className="mr-2 w-3.5" />}
              {OUTCOME_LABEL[value]}
            </DropdownMenuItem>
          ))}
          {moveTargets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  {moveTargets.map((p) => (
                    <DropdownMenuItem key={p.id} onSelect={() => onMove(p.id)}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// A column's heading, matching the uppercase section headings the
// single-project view uses for Wishlist / Confirmed / Draft window.
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label} ({count})
    </h3>
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-4 text-center text-xs text-muted-foreground">{children}</div>
  );
}

// ProjectIcon renders nothing for a project with neither an emoji nor an
// uploaded image; the columns want a placeholder either way so every head card
// lines up, so fall back to the project's initial on its accent.
function ColumnIcon({ project, accent }: { project: BoardProject; accent: string }) {
  if (project.icon || project.icon_url) return <ProjectIcon project={project} className="h-9 w-9" />;
  return (
    <span
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
      style={{ backgroundColor: accent, color: readableTextColor(accent) }}
      aria-hidden
    >
      {project.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function ProjectColumn({
  column,
  moveTargets,
  periodEndsAt,
  showRecruitingStatus,
  busyPickId,
  onReview,
  onOutcome,
  onMove,
  onAdd,
}: {
  column: BoardColumn;
  // Every other project drafting this period -- the only legal move targets.
  moveTargets: BoardProject[];
  periodEndsAt: string | undefined;
  showRecruitingStatus: boolean;
  busyPickId: string | null;
  onReview: (app: AppRow, projectId: string) => void;
  onOutcome: (card: BoardCard, projectId: string, outcome: Outcome) => void;
  onMove: (card: BoardCard, toProjectId: string) => void;
  onAdd: (project: BoardProject) => void;
}) {
  const { project, picks } = column;
  const accent = project.color || DEFAULT_ACCENT;
  const review = (app: AppRow) => onReview(app, project.id);

  return (
    <div className="flex w-[300px] shrink-0 flex-col gap-4">
      {/* Head card: the project's identity, painted with its own accent. */}
      <div className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5" style={accentStyle(accent)}>
        <ColumnIcon project={project} accent={accent} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold" title={project.name}>{project.name}</span>
          <span className="text-xs text-muted-foreground">
            {picks.length} drafted
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionHeading label="Drafted" count={picks.length} />
        {picks.length === 0 ? (
          <EmptySection>No one drafted yet.</EmptySection>
        ) : (
          picks.map((card) => (
            <StaticApplicantCard
              key={card.pickId}
              app={card.app}
              compact
              // A confirmed pick wears the project's accent; one still sitting
              // in an unsubmitted window keeps the draft window's white, so
              // nothing is hidden but the two still read differently.
              accent={card.submitted ? accent : null}
              staged={!card.submitted}
              periodEndsAt={periodEndsAt}
              showRank
              showRecruitingStatus={showRecruitingStatus}
              onReview={review}
              overlayExtra={
                <CardMenu
                  card={card}
                  project={project}
                  moveTargets={moveTargets}
                  busy={busyPickId === card.pickId}
                  onOutcome={(outcome) => onOutcome(card, project.id, outcome)}
                  onMove={(toProjectId) => onMove(card, toProjectId)}
                />
              }
            />
          ))
        )}

        {/* Same geometry as a compact card, dashed: an empty slot to fill. */}
        <button
          type="button"
          onClick={() => onAdd(project)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/40 px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus size={14} />
          Add member
        </button>
      </div>
    </div>
  );
}

export function AllProjectsBoard({
  periodId,
  periodEndsAt,
  counts,
  canDraft,
  showRecruitingStatus,
  onShowRecruitingStatusChange,
  onOpenSheet,
  onReview,
  reloadToken,
  onMutated,
}: {
  periodId: string | null;
  periodEndsAt: string | undefined;
  // Period headline numbers, already loaded by the page.
  counts: { applicants: number; projects: number } | null;
  // Full-access reviewer: the draft manager is theirs to open.
  canDraft: boolean;
  showRecruitingStatus: boolean;
  onShowRecruitingStatusChange: (next: boolean) => void;
  onOpenSheet: () => void;
  // Carries the column's project so review opens with the right context project.
  onReview: (app: AppRow, projectId: string) => void;
  // Bumped by the page when a review changes something the board shows.
  reloadToken: number;
  // Fired after the board itself changes an outcome or a placement, so the page
  // can refresh what it owns (period stats, the sheet view).
  onMutated?: () => void;
}) {
  const { columns, draftProjectIds, error, reload } = useAllProjectsBoard(periodId, true, reloadToken);
  // Which project's add-member picker is open, and its search text.
  const [addFor, setAddFor] = useState<BoardProject | null>(null);
  const [addFilter, setAddFilter] = useState("");
  // The pick currently mid-RPC -- its menu greys out until the reload lands.
  const [busyPickId, setBusyPickId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { applicants, load: loadApplicants } = usePeriodApplicants(periodId);

  useEffect(() => { if (addFor) loadApplicants(); }, [addFor, loadApplicants]);

  // Every RPC here runs the same way: clear the last error, call, surface the
  // message the function raised (they're written to be read), then reload. Only
  // draft_picks writes reach realtime -- set_draft_outcome touches applications
  // and project_members only -- so the explicit reload is load-bearing.
  const run = useCallback(
    async (pickId: string | null, call: () => PromiseLike<{ error: { message: string } | null }>) => {
      setActionError(null);
      setBusyPickId(pickId);
      try {
        const { error: rpcError } = await call();
        if (rpcError) {
          setActionError(rpcError.message || "That didn't work.");
          return;
        }
        await reload();
        onMutated?.();
      } finally {
        setBusyPickId(null);
      }
    },
    [reload, onMutated],
  );

  const setOutcome = useCallback(
    (card: BoardCard, projectId: string, outcome: Outcome) =>
      run(card.pickId, () =>
        createClient().rpc("set_draft_outcome", {
          p_application_id: card.app.id,
          p_project_id: projectId,
          p_outcome: outcome,
        }),
      ),
    [run],
  );

  const movePick = useCallback(
    (card: BoardCard, toProjectId: string) =>
      run(card.pickId, () =>
        createClient().rpc("move_draft_pick", { p_pick_id: card.pickId, p_project_id: toProjectId }),
      ),
    [run],
  );

  const addPick = useCallback(
    async (projectId: string, applicationId: string) => {
      if (!periodId) return;
      setAddFor(null);
      setAddFilter("");
      await run(null, () =>
        createClient().rpc("add_draft_pick", {
          p_period_id: periodId,
          p_project_id: projectId,
          p_application_id: applicationId,
        }),
      );
    },
    [periodId, run],
  );

  // Move targets are the other projects actually drafting this period; anything
  // else raises "That project is not drafting in this application period."
  const draftingProjects = (columns ?? [])
    .map((c) => c.project)
    .filter((p) => draftProjectIds.has(p.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every project</h2>
            <div className="flex items-center gap-1.5">
              <Switch
                id="board-show-recruiting-status"
                checked={showRecruitingStatus}
                onCheckedChange={onShowRecruitingStatusChange}
              />
              <Label
                htmlFor="board-show-recruiting-status"
                className="cursor-pointer text-[11px] font-medium text-muted-foreground"
              >
                Coffee & info
              </Label>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {counts
              ? `${counts.applicants} application${counts.applicants === 1 ? "" : "s"} across ${counts.projects} project${counts.projects === 1 ? "" : "s"}.`
              : "Loading counts…"}{" "}
            Scroll sideways for the rest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onOpenSheet} disabled={!periodId}>
            <Table2 size={14} className="mr-1.5" />
            Open sheet view
          </Button>
          {canDraft && (
            <Button asChild variant="outline" size="sm">
              <Link href="/manager/draft">
                <UserPlus size={14} className="mr-1.5" />
                Draft members
              </Link>
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {actionError && <p className="text-sm text-red-500">{actionError}</p>}

      {columns === null ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex w-[300px] shrink-0 flex-col gap-4">
              <div className="h-[62px] rounded-xl border bg-muted/30 animate-pulse" />
              <ApplicationListSkeleton rows={3} />
            </div>
          ))}
        </div>
      ) : columns.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
          No projects to review this period.
        </div>
      ) : (
        // Bottom padding leaves room for the overlay scrollbar under the columns.
        <ScrollArea orientation="horizontal" viewportClassName="pb-3">
          <div className="flex items-start gap-4">
            {columns.map((column) => (
              <ProjectColumn
                key={column.project.id}
                column={column}
                moveTargets={draftingProjects.filter((p) => p.id !== column.project.id)}
                periodEndsAt={periodEndsAt}
                showRecruitingStatus={showRecruitingStatus}
                busyPickId={busyPickId}
                onReview={onReview}
                onOutcome={setOutcome}
                onMove={movePick}
                onAdd={setAddFor}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {addFor && (
        <ApplicantPickerDialog
          title={`Add to ${addFor.name}`}
          applicants={applicants}
          alreadyPicked={
            columns?.find((c) => c.project.id === addFor.id)?.picks.map((card) => card.app.id) ?? []
          }
          filter={addFilter}
          onFilterChange={setAddFilter}
          onPick={(applicationId) => addPick(addFor.id, applicationId)}
          onClose={() => { setAddFor(null); setAddFilter(""); }}
        />
      )}
    </div>
  );
}
