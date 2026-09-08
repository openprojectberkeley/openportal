"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Play, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Period = { id: string; name: string; status: "draft" | "open" | "closed"; starts_at: string; ends_at: string };
type Project = { id: string; name: string };

// A project's participation in one round: its draft position and how many
// applicants it may take that round. `id` is the draft_round_projects row id.
type RoundProject = { id: string; project_id: string; name: string; pick_order: number; pick_count: number };
type Round = { id: string; round_number: number; projects: RoundProject[] };

// One stop in the flattened draft sequence: a project's turn within a round.
// Rounds with pick_count = 0 sit out, so they're excluded from the sequence.
type PickStop = RoundProject & { round_id: string; round_number: number };

// Pending destructive action, confirmed via the shared ConfirmDialog.
type ConfirmTarget =
  | { kind: "round"; roundId: string; label: string }
  | { kind: "project"; roundId: string; rowId: string; label: string };

function isOpenNow(p: Period): boolean {
  const now = Date.now();
  return p.status === "open" && new Date(p.starts_at).getTime() <= now && now < new Date(p.ends_at).getTime();
}

function pickDefault(list: Period[]): string | null {
  return list.find(isOpenNow)?.id ?? list[0]?.id ?? null;
}

function sortProjects(list: RoundProject[]): RoundProject[] {
  return [...list].sort((a, b) => a.pick_order - b.pick_order);
}

export function DraftRoundsManager() {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState<Project[] | null>(null);
  const [rounds, setRounds] = useState<Round[] | null>(null);
  // null current_pick_id (or no row at all) means the draft hasn't started.
  const [currentPickId, setCurrentPickId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const [{ data: periodRows }, { data: projectRows }] = await Promise.all([
        supabase
          .from("application_periods")
          .select("id, name, starts_at, ends_at, status")
          .order("created_at", { ascending: false }),
        supabase.from("projects").select("id, name").order("name"),
      ]);
      const list = (periodRows ?? []) as Period[];
      setPeriods(list);
      setSelectedPeriodId((cur) => cur ?? pickDefault(list));
      setAllProjects((projectRows ?? []) as Project[]);
    })();
  }, []);

  const loadRounds = useCallback(async (periodId: string) => {
    setRounds(null);
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("draft_rounds")
      .select("id, round_number, draft_round_projects(id, project_id, pick_order, pick_count, projects(name))")
      .eq("period_id", periodId)
      .order("round_number");
    if (loadError) { setError("Couldn't load draft rounds."); setRounds([]); return; }

    type RoundRow = {
      id: string;
      round_number: number;
      draft_round_projects: { id: string; project_id: string; pick_order: number; pick_count: number; projects: { name: string } | null }[];
    };
    const list = ((data ?? []) as unknown as RoundRow[]).map((r) => ({
      id: r.id,
      round_number: r.round_number,
      projects: sortProjects(
        r.draft_round_projects.map((rp) => ({
          id: rp.id,
          project_id: rp.project_id,
          name: rp.projects?.name ?? "Untitled project",
          pick_order: rp.pick_order,
          pick_count: rp.pick_count,
        })),
      ),
    }));
    setRounds(list);
  }, []);

  const loadDraftState = useCallback(async (periodId: string) => {
    const supabase = createClient();
    const { data } = await supabase.from("draft_state").select("current_pick_id").eq("period_id", periodId).maybeSingle();
    setCurrentPickId(data?.current_pick_id ?? null);
  }, []);

  useEffect(() => {
    if (selectedPeriodId) {
      loadRounds(selectedPeriodId);
      loadDraftState(selectedPeriodId);
    } else {
      setRounds(null);
      setCurrentPickId(null);
    }
  }, [selectedPeriodId, loadRounds, loadDraftState]);

  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId) ?? null;

  // The order picks actually happen in: every round in order, each round's
  // projects in pick_order, skipping any project sitting out (pick_count 0).
  const sequence: PickStop[] = (rounds ?? []).flatMap((r) =>
    r.projects.filter((p) => p.pick_count > 0).map((p) => ({ ...p, round_id: r.id, round_number: r.round_number })),
  );
  const currentIndex = currentPickId ? sequence.findIndex((s) => s.id === currentPickId) : -1;
  const currentStop = currentIndex >= 0 ? sequence[currentIndex] : null;

  const setPick = async (periodId: string, pickId: string | null) => {
    const supabase = createClient();
    const { error: writeError } = await supabase
      .from("draft_state")
      .upsert({ period_id: periodId, current_pick_id: pickId, updated_at: new Date().toISOString() });
    if (writeError) { setError("Couldn't save draft position."); return; }
    setCurrentPickId(pickId);
  };

  const startDraft = () => {
    if (!selectedPeriodId || sequence.length === 0) return;
    setPick(selectedPeriodId, sequence[0].id);
  };

  const stepTo = (index: number) => {
    if (!selectedPeriodId || index < 0 || index >= sequence.length) return;
    setPick(selectedPeriodId, sequence[index].id);
  };

  const resetDraft = () => {
    if (!selectedPeriodId) return;
    setPick(selectedPeriodId, null);
  };

  // A new round starts seeded with every current project, in alphabetical
  // order, one pick each -- the common case is every project drafts every
  // round and only the order/count per round changes, so this saves adding
  // each project by hand. Projects can still be removed/re-added per round.
  const addRound = async () => {
    if (!selectedPeriodId) return;
    const supabase = createClient();
    const nextNumber = (rounds?.[rounds.length - 1]?.round_number ?? 0) + 1;
    const { data: roundRow, error: insertError } = await supabase
      .from("draft_rounds")
      .insert({ period_id: selectedPeriodId, round_number: nextNumber })
      .select("id, round_number")
      .single();
    if (insertError || !roundRow) { setError("Couldn't create the round."); return; }

    const seed = allProjects ?? [];
    let seededRows: RoundProject[] = [];
    if (seed.length) {
      const { data: rpRows, error: seedError } = await supabase
        .from("draft_round_projects")
        .insert(seed.map((p, i) => ({ round_id: roundRow.id, project_id: p.id, pick_order: i + 1, pick_count: 1 })))
        .select("id, project_id, pick_order, pick_count");
      if (seedError) { setError("Round was created, but seeding projects failed."); }
      else {
        seededRows = (rpRows ?? []).map((rp) => ({
          id: rp.id,
          project_id: rp.project_id,
          name: seed.find((p) => p.id === rp.project_id)?.name ?? "Untitled project",
          pick_order: rp.pick_order,
          pick_count: rp.pick_count,
        }));
      }
    }

    setRounds((prev) => [
      ...(prev ?? []),
      { id: roundRow.id, round_number: roundRow.round_number, projects: sortProjects(seededRows) },
    ]);
  };

  const deleteRound = async (roundId: string) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("draft_rounds").delete().eq("id", roundId);
    if (deleteError) { setError("Couldn't delete the round."); return; }
    setRounds((prev) => prev?.filter((r) => r.id !== roundId) ?? null);
  };

  const addProjectToRound = async (roundId: string, project: Project) => {
    const round = rounds?.find((r) => r.id === roundId);
    if (!round) return;
    const nextOrder = round.projects.length ? Math.max(...round.projects.map((p) => p.pick_order)) + 1 : 1;
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("draft_round_projects")
      .insert({ round_id: roundId, project_id: project.id, pick_order: nextOrder })
      .select("id, pick_order, pick_count")
      .single();
    if (insertError || !data) { setError("Couldn't add that project to the round."); return; }
    setRounds((prev) =>
      (prev ?? []).map((r) =>
        r.id === roundId
          ? {
              ...r,
              projects: sortProjects([
                ...r.projects,
                { id: data.id, project_id: project.id, name: project.name, pick_order: data.pick_order, pick_count: data.pick_count },
              ]),
            }
          : r,
      ),
    );
  };

  const removeProjectFromRound = async (roundId: string, rowId: string) => {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("draft_round_projects").delete().eq("id", rowId);
    if (deleteError) { setError("Couldn't remove that project from the round."); return; }
    setRounds((prev) =>
      (prev ?? []).map((r) => (r.id === roundId ? { ...r, projects: r.projects.filter((p) => p.id !== rowId) } : r)),
    );
  };

  const persistOrder = async (list: RoundProject[]) => {
    const supabase = createClient();
    const results = await Promise.all(
      list.map((p) => supabase.from("draft_round_projects").update({ pick_order: p.pick_order }).eq("id", p.id)),
    );
    const failed = results.find((r) => r.error)?.error;
    if (failed) setError("Couldn't save the new order.");
  };

  const reorderRound = (roundId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRounds((prev) =>
      (prev ?? []).map((r) => {
        if (r.id !== roundId) return r;
        const oldIndex = r.projects.findIndex((p) => p.id === active.id);
        const newIndex = r.projects.findIndex((p) => p.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return r;
        const reordered = arrayMove(r.projects, oldIndex, newIndex).map((p, i) => ({ ...p, pick_order: i + 1 }));
        persistOrder(reordered);
        return { ...r, projects: reordered };
      }),
    );
  };

  const updatePickCount = (roundId: string, rowId: string, value: number) => {
    setRounds((prev) =>
      (prev ?? []).map((r) =>
        r.id === roundId ? { ...r, projects: r.projects.map((p) => (p.id === rowId ? { ...p, pick_count: value } : p)) } : r,
      ),
    );
  };

  const commitPickCount = async (rowId: string, value: number) => {
    const supabase = createClient();
    const { error: updateError } = await supabase.from("draft_round_projects").update({ pick_count: value }).eq("id", rowId);
    if (updateError) setError("Couldn't save the pick count.");
  };

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Period picker */}
      {periods === null ? (
        <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
      ) : periods.length === 0 ? (
        <span className="text-sm text-muted-foreground">No application periods yet.</span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 self-start border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
              <span className="text-muted-foreground">Draft for</span>
              <span className="font-medium">{selectedPeriod?.name ?? "Select period"}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {periods.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => setSelectedPeriodId(p.id)}>
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {selectedPeriodId && rounds !== null && rounds.length > 0 && (
        <div className="border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 bg-muted/30">
          {currentStop === null ? (
            <>
              <span className="text-sm text-muted-foreground">
                {sequence.length === 0 ? "No projects with picks to draft yet." : `${sequence.length} pick${sequence.length === 1 ? "" : "s"} queued up.`}
              </span>
              <Button size="sm" onClick={startDraft} disabled={sequence.length === 0}>
                <Play size={14} className="mr-1.5" />
                Start draft
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  Pick {currentIndex + 1} of {sequence.length} — Round {currentStop.round_number}
                </span>
                <span className="text-sm font-semibold">
                  {currentStop.name}
                  <span className="ml-2 font-normal text-muted-foreground">
                    ({currentStop.pick_count} pick{currentStop.pick_count === 1 ? "" : "s"})
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => stepTo(currentIndex - 1)} disabled={currentIndex <= 0}>
                  <ChevronLeft size={14} className="mr-1" />
                  Back
                </Button>
                <Button size="sm" onClick={() => stepTo(currentIndex + 1)} disabled={currentIndex >= sequence.length - 1}>
                  Next
                  <ChevronRight size={14} className="ml-1" />
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetDraft}>
                  <RotateCcw size={13} className="mr-1.5" />
                  Reset
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {selectedPeriodId && (
        <div className="flex flex-col gap-4">
          {rounds === null ? (
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
          ) : rounds.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
              No rounds yet. Add one to start setting up the draft.
            </div>
          ) : (
            rounds.map((round) => (
              <RoundCard
                key={round.id}
                round={round}
                currentPickId={currentPickId}
                addableProjects={(allProjects ?? []).filter((p) => !round.projects.some((rp) => rp.project_id === p.id))}
                onDeleteRound={() => setConfirmTarget({ kind: "round", roundId: round.id, label: `Round ${round.round_number}` })}
                onAddProject={(project) => addProjectToRound(round.id, project)}
                onRemoveProject={(rp) =>
                  setConfirmTarget({ kind: "project", roundId: round.id, rowId: rp.id, label: rp.name })
                }
                onReorder={(event) => reorderRound(round.id, event)}
                onPickCountChange={(rowId, value) => updatePickCount(round.id, rowId, value)}
                onPickCountCommit={commitPickCount}
              />
            ))
          )}

          <Button variant="outline" size="sm" className="self-start" onClick={addRound}>
            <Plus size={14} className="mr-1.5" />
            Add round
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        title={confirmTarget?.kind === "round" ? `Delete ${confirmTarget.label}?` : `Remove ${confirmTarget?.label}?`}
        description={
          confirmTarget?.kind === "round"
            ? "This removes the round and every project's order/pick count within it."
            : "This project will no longer draft in this round."
        }
        confirmLabel={confirmTarget?.kind === "round" ? "Delete round" : "Remove"}
        onConfirm={() => {
          if (!confirmTarget) return;
          if (confirmTarget.kind === "round") return deleteRound(confirmTarget.roundId);
          return removeProjectFromRound(confirmTarget.roundId, confirmTarget.rowId);
        }}
      />
    </div>
  );
}

function RoundCard({
  round,
  currentPickId,
  addableProjects,
  onDeleteRound,
  onAddProject,
  onRemoveProject,
  onReorder,
  onPickCountChange,
  onPickCountCommit,
}: {
  round: Round;
  currentPickId: string | null;
  addableProjects: Project[];
  onDeleteRound: () => void;
  onAddProject: (project: Project) => void;
  onRemoveProject: (rp: RoundProject) => void;
  onReorder: (event: DragEndEvent) => void;
  onPickCountChange: (rowId: string, value: number) => void;
  onPickCountCommit: (rowId: string, value: number) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
    <div className="border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Round {round.round_number}</h3>
        <div className="flex items-center gap-2">
          {addableProjects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs">
                  <Plus size={13} className="mr-1.5" />
                  Add project
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {addableProjects.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => onAddProject(p)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={onDeleteRound}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {round.projects.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-lg">
          No projects in this round.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
          <SortableContext items={round.projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {round.projects.map((rp, i) => (
                <SortableRow
                  key={rp.id}
                  rp={rp}
                  position={i + 1}
                  isCurrent={rp.id === currentPickId}
                  onRemove={() => onRemoveProject(rp)}
                  onPickCountChange={(value) => onPickCountChange(rp.id, value)}
                  onPickCountCommit={(value) => onPickCountCommit(rp.id, value)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableRow({
  rp,
  position,
  isCurrent,
  onRemove,
  onPickCountChange,
  onPickCountCommit,
}: {
  rp: RoundProject;
  position: number;
  isCurrent: boolean;
  onRemove: () => void;
  onPickCountChange: (value: number) => void;
  onPickCountCommit: (value: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rp.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 bg-background ${isCurrent ? "border-primary ring-1 ring-primary" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>
      <span className="w-5 shrink-0 text-xs font-medium text-muted-foreground">{position}.</span>
      <span className="flex-1 min-w-0 truncate text-sm font-medium">{rp.name}</span>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Picks
        <Input
          type="number"
          min={0}
          value={rp.pick_count}
          onChange={(e) => onPickCountChange(Number(e.target.value))}
          onBlur={(e) => onPickCountCommit(Number(e.target.value))}
          className="h-7 w-16 px-2 text-xs"
        />
      </label>
      <button
        onClick={onRemove}
        className="text-muted-foreground/50 hover:text-destructive"
        aria-label={`Remove ${rp.name} from this round`}
      >
        <X size={15} />
      </button>
    </div>
  );
}
