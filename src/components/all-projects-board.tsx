"use client";

// The cross-project board behind ?project=all on the applications manager: one
// column per project, scrolled horizontally, showing who the draft picked for
// it -- newly drafted people only, not the existing roster, no round breakdown,
// and staged/confirmed in a single list.
//
// This is also where drafting is finished, so it is no longer read-only: each
// card carries a hover menu that records the applicant's answer to the
// confirmation we sent them (Drafted / Accepted / Rejected) or moves them to
// another project, and each column ends in an add-member card. All three go
// through the exec-only RPCs from migration 0091 -- RLS makes a client-side
// move impossible by design (no UPDATE policy on draft_picks, DELETE only
// while a round is unsubmitted).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, Table2, UserPlus, UserSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { ProjectIcon } from "@/components/project-icon";
import { applicantName, StaticApplicantCard, type AppRow } from "@/components/applicant-meta";
import { InvalidIndicator } from "@/components/applicant-indicators";
import { ApplicantPickerPopover } from "@/components/applicant-picker-dialog";
import { ApplicationListSkeleton } from "@/components/skeletons";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_ACCENT, accentFill, readableTextColor } from "@/lib/portal-color";
import {
  useAllProjectsBoard,
  usePeriodApplicants,
  usePeriodRoster,
  type BoardCard,
  type BoardColumn,
  type BoardProject,
  type RosterRow,
} from "@/lib/use-all-projects-board";
import type { AddableMember } from "@/components/applicant-picker-dialog";
import { staggerStyle } from "@/lib/motion";
import { toast } from "sonner";
import { undraftedIds } from "@/lib/draft-status";

// The three states the per-card menu cycles between, and all three are THEIR
// decision, not ours: we draft, we email the confirmation, they answer.
// "drafted" is the default -- sent, no reply yet. "accepted" is the only one
// that does anything: it makes them an official member of this column's
// project (accept_application, 0057). "rejected" is a label; nothing else
// happens on it yet (0092).
type Outcome = "drafted" | "accepted" | "rejected";

const OUTCOME_LABEL: Record<Outcome, string> = {
  drafted: "Drafted",
  accepted: "Accepted",
  rejected: "Rejected",
};

// What the chip says, read off MEMBERSHIP rather than applications.status:
// "accepted" means they are actually on this column's project (0106).
//
// The two used to be able to disagree. Removing someone from a project
// portal's member list deletes their project_members row (and the managed
// portal_members row with it) without touching their application, so a card
// could sit here green and "Accepted" while the person had no project, no
// project portal, and no project-coloured banner anywhere in the app. The
// application is a record of a decision; membership is the thing that decision
// was supposed to produce. Report the latter, so what the board claims and
// what the member experiences cannot come apart.
//
// Rejection has no membership equivalent -- nothing is created by it -- so it
// still comes from the application, and only once membership has ruled
// "accepted" out. 0106 makes the menu's other two outcomes clear this column's
// membership, so a stale row can't outrank a later click.
//
// No project id: a BoardCard is already a per-column projection, and `isMember`
// was resolved against that column when the card was built.
function outcomeOf(card: BoardCard): Outcome {
  if (card.isMember) return "accepted";
  if (card.app.status === "rejected") return "rejected";
  return "drafted";
}

// The board's rows with any in-flight outcome click already applied. Clicking
// the menu repaints the chip immediately instead of waiting for the RPC and the
// reload behind it; patching the rows here (rather than threading an override
// down to the chip) keeps outcomeOf the single definition of what a card shows,
// so the colour, pinned-vs-hover-only, and the card's own status badge all
// follow from the same place. Reverted by the caller if the RPC says no.
function withPendingOutcomes(
  columns: BoardColumn[] | null,
  pending: Record<string, Outcome>,
): BoardColumn[] | null {
  if (!columns || Object.keys(pending).length === 0) return columns;
  return columns.map((column) => ({
    ...column,
    picks: column.picks.map((card) => {
      const outcome = pending[card.pickId];
      if (!outcome) return card;
      return {
        ...card,
        // Mirrors what set_draft_outcome writes: 'drafted' is back to
        // undecided, and only an accept carries a placement.
        app: { ...card.app, status: outcome === "drafted" ? "submitted" : outcome },
        acceptedProjectId: outcome === "accepted" ? column.project.id : null,
        // And what it writes to project_members: an accept creates this
        // column's membership, the other two clear it (0106). This is the field
        // outcomeOf actually reads, so without it the chip would wait for the
        // reload -- the one thing the optimistic patch exists to avoid.
        isMember: outcome === "accepted",
      };
    }),
  }));
}

// The board with any in-flight "Move to" already applied: the card leaves its
// column and joins the target's at once, instead of greying out until the RPC
// and reload land. Cleared (and so reverted) by the caller on failure.
function withPendingMoves(
  columns: BoardColumn[] | null,
  moves: Record<string, string>,
): BoardColumn[] | null {
  if (!columns || Object.keys(moves).length === 0) return columns;
  const moving = new Map<string, BoardCard>();
  const stripped = columns.map((column) => ({
    ...column,
    picks: column.picks.filter((card) => {
      const to = moves[card.pickId];
      if (!to || to === column.project.id) return true;
      moving.set(card.pickId, card);
      return false;
    }),
  }));
  return stripped.map((column) => {
    const arriving = [...moving.entries()]
      .filter(([pickId]) => moves[pickId] === column.project.id)
      .map(([, card]) => card);
    return arriving.length ? { ...column, picks: [...column.picks, ...arriving] } : column;
  });
}

// Clicks inside the card must not reach the card root, whose onClick opens the
// review modal -- same helper the card's own overlay buttons use.
const stopClick = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
};

// The hover menu itself. Lives in the card's overlay slot, so it takes no
// layout width and rides the same gradient veil as the card's other actions.
// The labels are deliberately the bare words -- the tooltip and the menu's own
// heading are what say whose decision they record.
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
  const outcome = outcomeOf(card);
  // Accepted, but onto some other project: the card's own green "Accepted"
  // badge is the application's global status, while this column's outcome is
  // still just "Drafted". Say so on the chip rather than letting the two read
  // as a contradiction.
  const elsewhere = card.app.status === "accepted" && card.acceptedProjectId !== project.id;
  // "Move to" lists every drafting project (~20); a search box narrows it.
  const [moveQuery, setMoveQuery] = useState("");
  const mq = moveQuery.trim().toLowerCase();
  const shownTargets = mq ? moveTargets.filter((p) => p.name.toLowerCase().includes(mq)) : moveTargets;
  const explain: Record<Outcome, string> = {
    drafted: "Drafted — confirmation sent, no reply yet",
    accepted: `Accepted — they took the offer; now a member of ${project.name}`,
    rejected: "Rejected — they turned the offer down",
  };
  return (
    <div {...stopClick} className="flex shrink-0 items-center">
      <DropdownMenu onOpenChange={(o) => { if (!o) setMoveQuery(""); }}>
        <DropdownMenuTrigger asChild disabled={busy}>
          {/* A control, so it stays a chip, but light: coloured text + chevron. */}
          <button
            type="button"
            className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium hover:bg-foreground/[0.06] ${
              outcome === "accepted" ? "text-success"
              : outcome === "rejected" ? "text-destructive"
              : "text-muted-foreground"
            } ${busy ? "opacity-50" : ""}`}
            title={elsewhere ? "Accepted onto another project" : explain[outcome]}
          >
            {OUTCOME_LABEL[outcome]}
            <ChevronDown size={12} className="opacity-70" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Their response
          </DropdownMenuLabel>
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
                <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                  {moveTargets.length > 8 && (
                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5">
                      <Search className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      <input
                        autoFocus
                        value={moveQuery}
                        onChange={(e) => setMoveQuery(e.target.value)}
                        // Keep letters in the box instead of Radix typeahead.
                        onKeyDown={(e) => {
                          if (e.key !== "ArrowDown" && e.key !== "Escape" && e.key !== "ArrowLeft") e.stopPropagation();
                        }}
                        placeholder="Search projects…"
                        aria-label="Search projects to move to"
                        className="h-7 w-full border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                  )}
                  {shownTargets.length === 0 && (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>
                  )}
                  {shownTargets.map((p) => (
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

function EmptySection({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-3 text-xs text-muted-foreground">{children}</div>
  );
}

// ProjectIcon renders nothing for a project with neither an emoji nor an
// uploaded image; the columns want a placeholder either way so every head card
// lines up, so fall back to the project's initial on its accent.
// The head card is painted in `accent` now, so the icon can't also be that
// colour or it disappears into it — both branches use a scrim of the card's
// readable foreground instead.
function ColumnIcon({ project, accent }: { project: BoardProject; accent: string }) {
  if (project.icon || project.icon_url) {
    return <ProjectIcon project={project} className="h-9 w-9" onAccent />;
  }
  const fg = readableTextColor(accent);
  return (
    <span
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${fg} 18%, transparent)`, color: fg }}
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
  busyPickId,
  onReview,
  onOutcome,
  onMove,
  addControl,
  onDraft,
}: {
  column: BoardColumn;
  // Every other project drafting this period -- the only legal move targets.
  moveTargets: BoardProject[];
  periodEndsAt: string | undefined;
  busyPickId: string | null;
  onReview: (app: AppRow, projectId: string) => void;
  onOutcome: (card: BoardCard, projectId: string, outcome: Outcome) => void;
  onMove: (card: BoardCard, toProjectId: string) => void;
  // The "Add member" row: a trigger wrapped in its picker overlay.
  addControl: React.ReactNode;
  // Confirm a staged pick for this project (an exec placement).
  onDraft: (card: BoardCard) => void;
}) {
  const { project } = column;
  // Confirmed picks first; anyone merely staged (an unsubmitted window) sits
  // at the very bottom with a Draft button.
  const picks = column.picks.filter((c) => c.submitted);
  const staged = column.picks.filter((c) => !c.submitted);
  const accent = project.color || DEFAULT_ACCENT;
  const review = (app: AppRow) => onReview(app, project.id);

  return (
    <div className="flex w-[300px] shrink-0 flex-col gap-4">
      {/* Head card: the project's identity, painted with its own accent. */}
      <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={accentFill(accent)}>
        <ColumnIcon project={project} accent={accent} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold" title={project.name}>{project.name}</span>
          {/* opacity rather than text-muted-foreground: the head card is painted
              in the project's accent now, and a theme-fixed muted grey is
              unreadable on an arbitrary colour. */}
          <span className="text-xs tabular-nums opacity-70">
            {picks.length} drafted
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {picks.length === 0 && staged.length === 0 ? (
          <EmptySection>No one drafted yet</EmptySection>
        ) : (
          // A plain list: rows split by faint dividers, no cards, no colour.
          <div className="flex flex-col divide-y divide-foreground/[0.06]">
          {picks.map((card, i) => {
            // Once someone has answered, the chip stops being a hover action and
            // becomes the row's resting state, pinned at its right edge.
            const decided = outcomeOf(card) !== "drafted";
            return (
              <div key={card.pickId} className="animate-fade-in-up" style={staggerStyle(i)}>
              <StaticApplicantCard
                app={card.app}
                compact
                periodEndsAt={periodEndsAt}
                onReview={review}
                pinExtra={decided}
                hideStatus={decided}
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
              </div>
            );
          })}
          </div>
        )}

        {staged.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Staged <span className="font-normal tabular-nums">{staged.length}</span>
            </h3>
            <div className="flex flex-col divide-y divide-foreground/[0.06]">
              {staged.map((card, i) => (
                <div key={card.pickId} className="animate-fade-in-up" style={staggerStyle(picks.length + i)}>
                  <StaticApplicantCard
                    app={card.app}
                    compact
                    periodEndsAt={periodEndsAt}
                    onReview={review}
                    pinExtra
                    overlayExtra={
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyPickId === card.pickId}
                        className="h-6 px-2 text-xs"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); onDraft(card); }}
                      >
                        Draft
                      </Button>
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* A ghost row at the end of the list; opens a small picker overlay. */}
        {addControl}
      </div>
    </div>
  );
}

// The "who's left" list, opened from the board toolbar: every draft-eligible
// applicant this period without a confirmed pick. Read-only -- placing someone
// still happens on a column's add-member card -- but a name opens the same
// application card the columns do, and the recruiting indicators carry over so
// an exec can see at a glance why someone may have gone unpicked.
function UndraftedDialog({
  rows,
  stagedByAppId,
  filter,
  onFilterChange,
  open,
  onOpenApplicant,
  onClose,
}: {
  rows: RosterRow[] | null;
  // Applicants staged on a project but not confirmed yet, by application id --
  // still undrafted, but worth saying where they are sitting.
  stagedByAppId: Map<string, string[]>;
  periodEndsAt: string | undefined;
  filter: string;
  onFilterChange: (value: string) => void;
  open: boolean;
  onOpenApplicant: (app: AppRow) => void;
  onClose: () => void;
}) {
  const needle = filter.trim().toLowerCase();
  const options = (rows ?? []).filter((r) => applicantName(r.app).toLowerCase().includes(needle));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Not drafted
            {rows && (
              <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                {rows.length} {rows.length === 1 ? "person" : "people"}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Search applicants…"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
          />
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {rows === null ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading applicants…</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {rows.length === 0 ? "Everyone eligible has been drafted." : "No matching applicants."}
              </p>
            ) : (
              options.map(({ app }) => {
                const staged = stagedByAppId.get(app.id);
                return (
                  <div key={app.id} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm bg-background shadow-edge">
                    <button
                      type="button"
                      onClick={() => onOpenApplicant(app)}
                      className="min-w-0 truncate text-left font-medium hover:underline"
                    >
                      {applicantName(app)}
                    </button>
                    <InvalidIndicator valid={app.valid} />
                    {staged && (
                      <span className="ml-auto min-w-0 max-w-[50%] shrink-0 truncate text-xs text-muted-foreground">
                        Staged{staged.length > 0 ? ` · ${staged.join(", ")}` : ""}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AllProjectsBoard({
  periodId,
  periodEndsAt,
  counts,
  canDraft,
  onOpenSheet,
  onReview,
  reviewOpen,
  reloadToken,
  onMutated,
}: {
  periodId: string | null;
  periodEndsAt: string | undefined;
  // Period headline numbers, already loaded by the page.
  counts: { applicants: number; projects: number } | null;
  // Full-access reviewer: the draft manager is theirs to open.
  canDraft: boolean;
  onOpenSheet: () => void;
  // Carries the column's project so review opens with the right context project.
  // The "not drafted" list has no column behind it, hence the null.
  onReview: (app: AppRow, projectId: string | null) => void;
  // Whether the page's review modal is up. The "not drafted" list stays mounted
  // behind it rather than stacking: both dialogs sit at z-50, so showing them
  // together would double the scrim and the focus trap.
  reviewOpen: boolean;
  // Bumped by the page when a review changes something the board shows.
  reloadToken: number;
  // Fired after the board itself changes an outcome or a placement, so the page
  // can refresh what it owns (period stats, the sheet view).
  onMutated?: () => void;
}) {
  const { columns: loadedColumns, draftProjectIds, error, reload } = useAllProjectsBoard(periodId, true, reloadToken);
  // Outcome clicks that haven't come back from the database yet, by pick.
  const [pendingOutcome, setPendingOutcome] = useState<Record<string, Outcome>>({});
  // "Move to" clicks still in flight, by pick: target project id.
  const [pendingMove, setPendingMove] = useState<Record<string, string>>({});
  const columns = useMemo(
    () => withPendingMoves(withPendingOutcomes(loadedColumns, pendingOutcome), pendingMove),
    [loadedColumns, pendingOutcome, pendingMove],
  );
  // Per-pick click counter, so a slow answer to an earlier click can't clear
  // (or report an error over) the chip a later click is already showing.
  const outcomeSeq = useRef(new Map<string, number>());
  // Which project's add-member picker is open, and its search text.
  const [addFor, setAddFor] = useState<BoardProject | null>(null);
  // The pick currently mid-RPC -- its menu greys out until the reload lands.
  // Only move/add use it: an outcome repaints optimistically instead, so its
  // menu stays live and undimmed throughout.
  const [busyPickId, setBusyPickId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { applicants, load: loadApplicants } = usePeriodApplicants(periodId);
  // The "not drafted" list: everyone the draft hasn't placed yet.
  const [undraftedOpen, setUndraftedOpen] = useState(false);
  const [undraftedFilter, setUndraftedFilter] = useState("");
  const { roster, draftStatus, load: loadRoster } = usePeriodRoster(periodId, reloadToken);

  useEffect(() => { if (addFor) loadApplicants(); }, [addFor, loadApplicants]);

  // A period switch reloads the roster from scratch, so a list left open here
  // would sit on its loading state against the new period forever.
  useEffect(() => { setUndraftedOpen(false); }, [periodId]);

  const openUndrafted = () => {
    setUndraftedFilter("");
    setUndraftedOpen(true);
    loadRoster();
  };

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

  const clearPending = useCallback((pickId: string) => {
    setPendingOutcome((prev) => {
      if (!(pickId in prev)) return prev;
      const next = { ...prev };
      delete next[pickId];
      return next;
    });
  }, []);

  // Unlike move/add this doesn't go through `run`: the chip changes on click
  // and the RPC catches up behind it. The reload still happens (set_draft_outcome
  // writes applications/project_members, which realtime doesn't carry), and
  // clearing the pending entry afterwards hands the chip back to loaded data
  // that already says the same thing. A failure puts it back where it was and
  // shows why.
  const setOutcome = useCallback(
    async (card: BoardCard, projectId: string, outcome: Outcome) => {
      const pickId = card.pickId;
      const seq = (outcomeSeq.current.get(pickId) ?? 0) + 1;
      outcomeSeq.current.set(pickId, seq);
      setActionError(null);
      setPendingOutcome((prev) => ({ ...prev, [pickId]: outcome }));

      const { error: rpcError } = await createClient().rpc("set_draft_outcome", {
        p_application_id: card.app.id,
        p_project_id: projectId,
        p_outcome: outcome,
      });
      // A later click on this same card owns the chip now; let its own call
      // finish the job.
      if (outcomeSeq.current.get(pickId) !== seq) return;

      if (rpcError) {
        setActionError(rpcError.message || "That didn't work.");
        clearPending(pickId);
        return;
      }
      await reload();
      if (outcomeSeq.current.get(pickId) !== seq) return;
      clearPending(pickId);
      onMutated?.();
    },
    [reload, onMutated, clearPending],
  );

  // Optimistic: the card jumps columns on click; the RPC and reload follow,
  // then the pending entry hands the card back to loaded data that already
  // agrees. A refusal drops the entry (the card jumps back) and shows why.
  const movePick = useCallback(
    async (card: BoardCard, toProjectId: string) => {
      const pickId = card.pickId;
      const clearMove = () =>
        setPendingMove((prev) => {
          if (!(pickId in prev)) return prev;
          const next = { ...prev };
          delete next[pickId];
          return next;
        });
      setActionError(null);
      setPendingMove((prev) => ({ ...prev, [pickId]: toProjectId }));
      const { error: rpcError } = await createClient().rpc("move_draft_pick", {
        p_pick_id: pickId,
        p_project_id: toProjectId,
      });
      if (rpcError) {
        clearMove();
        setActionError(rpcError.message || "That didn't work.");
        toast.error("Couldn't move that pick", { description: rpcError.message });
        return;
      }
      await reload();
      clearMove();
      onMutated?.();
    },
    [reload, onMutated],
  );

  const addPick = useCallback(
    async (projectId: string, applicationId: string) => {
      if (!periodId) return;
      setAddFor(null);
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

  // Someone with no application: the RPC creates their application row (or
  // submits the draft they abandoned) and then places the pick, so from here it
  // is the same one-shot mutation as addPick and reloads the board the same way.
  const addMember = useCallback(
    async (projectId: string, userId: string) => {
      if (!periodId) return;
      setAddFor(null);
      await run(null, () =>
        createClient().rpc("add_member_to_draft", {
          p_period_id: periodId,
          p_project_id: projectId,
          p_user_id: userId,
        }),
      );
    },
    [periodId, run],
  );

  // Who the draft has actually placed, and who is merely staged and on which
  // project. A staged applicant can sit under two projects at once -- draft_picks
  // is unique on (round_project_id, application_id), not on the applicant -- so
  // the project names are a list. Rejected picks are skipped: the card stays on
  // the board with a red badge (0091), but the roster below excludes them too,
  // so counting them here would make the two disagree.
  const confirmedAppIds = new Set<string>();
  const stagedByAppId = new Map<string, string[]>();
  for (const column of columns ?? []) {
    for (const card of column.picks) {
      if (card.app.status === "rejected") continue;
      if (card.submitted) {
        confirmedAppIds.add(card.app.id);
        continue;
      }
      const names = stagedByAppId.get(card.app.id) ?? [];
      names.push(column.project.name);
      stagedByAppId.set(card.app.id, names);
    }
  }
  // Anyone accepted outside the draft AND actually on that project is already
  // placed, so they don't belong on the list even though they have no pick.
  // `placed`, not `acceptedProjectId`: an acceptance whose roster row was later
  // removed has left them unplaced, and the point of this list is who still
  // needs placing (0106).
  // One rule for the button, the list, the draft page and analytics
  // (src/lib/draft-status.ts), applied to the live confirmed picks.
  const undraftedSet = draftStatus ? undraftedIds(draftStatus.apps, confirmedAppIds, draftStatus.memberKeys) : null;
  const undrafted = (roster ?? []).filter((r) => undraftedSet?.has(r.app.id));
  const undraftedCount = undraftedSet ? undraftedSet.size : null;

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
            <h2 className="text-base font-semibold tracking-tight">Every project</h2>
          </div>
          {counts ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              {counts.applicants} application{counts.applicants === 1 ? "" : "s"} · {counts.projects} project{counts.projects === 1 ? "" : "s"}
            </p>
          ) : (
            <span className="h-3.5 w-40 animate-pulse rounded-full bg-foreground/[0.09]" aria-hidden />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Only offered when this period actually has a draft -- before one is
              set up everyone is undrafted, which says nothing. */}
          {undraftedCount !== null && draftProjectIds.size > 0 && (
            <Button variant="outline" size="sm" onClick={openUndrafted}>
              <UserSearch size={14} className="mr-1.5" />
              {undraftedCount} not drafted
            </Button>
          )}
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

      {error && <p className="text-sm text-destructive">{error}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {columns === null ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex w-[300px] shrink-0 flex-col gap-4">
              <div className="h-[62px] rounded-xl bg-foreground/[0.09] animate-pulse" />
              <ApplicationListSkeleton rows={3} />
            </div>
          ))}
        </div>
      ) : columns.length === 0 ? (
        <div className="rounded-xl surface px-4 py-10 text-center text-sm text-muted-foreground">
          No projects to review this period.
        </div>
      ) : (
        // Bottom padding leaves room for the overlay scrollbar under the columns.
        <ScrollArea orientation="horizontal" viewportClassName="pb-3">
          <div className="flex items-start gap-4">
            {columns.map((column, i) => (
              <div key={column.project.id} className="shrink-0 animate-fade-in-up" style={staggerStyle(i)}>
              <ProjectColumn
                column={column}
                moveTargets={draftingProjects.filter((p) => p.id !== column.project.id)}
                periodEndsAt={periodEndsAt}
                busyPickId={busyPickId}
                onReview={onReview}
                onOutcome={setOutcome}
                onMove={movePick}
                addControl={
                  <ApplicantPickerPopover
                    open={addFor?.id === column.project.id}
                    onOpenChange={(o) => setAddFor(o ? column.project : null)}
                    applicants={applicants}
                    alreadyPicked={column.picks.map((card) => card.app.id)}
                    onPick={(applicationId) => addPick(column.project.id, applicationId)}
                    memberSearch={{
                      periodId,
                      onPick: (m: AddableMember) => addMember(column.project.id, m.user_id),
                    }}
                  >
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground data-[state=open]:bg-foreground/[0.04] data-[state=open]:text-foreground"
                    >
                      <Plus size={14} />
                      Add member
                    </button>
                  </ApplicantPickerPopover>
                }
                onDraft={(card) => addPick(column.project.id, card.app.id)}
              />
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {undraftedOpen && (
        <UndraftedDialog
          rows={roster && undrafted}
          stagedByAppId={stagedByAppId}
          periodEndsAt={periodEndsAt}
          filter={undraftedFilter}
          onFilterChange={setUndraftedFilter}
          // Hidden, not unmounted, while a review card is up: closing the
          // review brings this back with its filter intact.
          open={!reviewOpen}
          onOpenApplicant={(app) => onReview(app, null)}
          onClose={() => setUndraftedOpen(false)}
        />
      )}
    </div>
  );
}
