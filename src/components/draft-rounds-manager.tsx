"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Play, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReturningIndicator } from "@/components/applicant-meta";
import { LateBadge, InvalidIndicator } from "@/components/applicant-indicators";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectIcon } from "@/components/project-icon";
import { ApplicationReviewModal, type ReviewStatus } from "@/components/application-review-modal";
import { useDraftRealtime } from "@/lib/use-draft-realtime";
import { rankLabel } from "@/lib/application-rank";
import { isRecruitingValid } from "@/lib/utils";
import { chunkIds, selectInChunks } from "@/lib/postgrest-chunk";

type Period = { id: string; name: string; status: "draft" | "open" | "closed"; starts_at: string; ends_at: string };

type RecruitingFlags = {
  name: string;
  returning: boolean;
  coffeeDone: boolean;
  infosession: boolean;
  boardExec: boolean;
};

// Project detail carried alongside each round-project so tiles can render an
// icon/accent and the info dialog can show est. team size etc.
type ProjectMeta = {
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  type: string | null;
  client: string | null;
  description: string | null;
  difficulty: string | null;
  estimated_members: number | null;
  num_subteams: number | null;
};
type Project = { id: string; name: string } & ProjectMeta;

const PROJECT_COLS = "id, name, icon, icon_url, color, type, client, description, difficulty, estimated_members, num_subteams";

// A project's participation in one round: its draft position and how many
// applicants it may take that round. `id` is the draft_round_projects row id.
type RoundProject = { id: string; project_id: string; name: string; pick_order: number; pick_count: number } & ProjectMeta;
type Round = { id: string; round_number: number; projects: RoundProject[] };

// Recruiting indicators shown on the exec draft board's picks, matching the PM
// applications view: returning member, late submission, and recruiting-invalid.
type PickIndicators = { returning: boolean; invalid: boolean; submittedAt: string | null };

// One stop in the flattened draft sequence: a project's turn within a round.
// Rounds with pick_count = 0 sit out, so they're excluded from the sequence.
type PickStop = RoundProject & { round_id: string; round_number: number };

// Pending destructive action, confirmed via the shared ConfirmDialog.
type ConfirmTarget =
  | { kind: "round"; roundId: string; label: string }
  | { kind: "project"; roundId: string; rowId: string; label: string }
  | { kind: "reset" }
  | { kind: "complete" }
  | { kind: "unsubmit"; roundProjectId: string; label: string };

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

// Pulls the display/detail fields off a Project so they can ride along on the
// round-project rows (tiles + info dialog). Falls back to nulls if unknown.
function projectMeta(p: Project | undefined): ProjectMeta {
  return {
    icon: p?.icon ?? null,
    icon_url: p?.icon_url ?? null,
    color: p?.color ?? null,
    type: p?.type ?? null,
    client: p?.client ?? null,
    description: p?.description ?? null,
    difficulty: p?.difficulty ?? null,
    estimated_members: p?.estimated_members ?? null,
    num_subteams: p?.num_subteams ?? null,
  };
}

export function DraftRoundsManager() {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState<Project[] | null>(null);
  const [rounds, setRounds] = useState<Round[] | null>(null);
  // null current_pick_id (or no row at all) means the draft hasn't started.
  const [currentPickId, setCurrentPickId] = useState<string | null>(null);
  // Once set, the draft is finished: every confirmed pick has been placed
  // on its project, and Reset/further submissions are blocked.
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [working, setWorking] = useState(false);
  // Live draft board: per round-project, its picks + whether the round is
  // submitted (confirmed), plus a name lookup for the picked applicants.
  const [boardRows, setBoardRows] = useState<Record<string, { submittedAt: string | null; appIds: string[] }>>({});
  const [nameByAppId, setNameByAppId] = useState<Record<string, string>>({});
  const [statusByAppId, setStatusByAppId] = useState<Record<string, ReviewStatus>>({});
  // Recruiting indicators (returning / late / invalid) per picked application,
  // mirroring the PM applications view.
  const [indByAppId, setIndByAppId] = useState<Record<string, PickIndicators>>({});
  // Applicant preference for the project that picked them: key `${appId}:${projectId}`.
  const [rankByAppProject, setRankByAppProject] = useState<Record<string, number>>({});
  // A project tile / applicant name was clicked -> open its info modal.
  const [infoProject, setInfoProject] = useState<RoundProject | null>(null);
  const [reviewFor, setReviewFor] = useState<{ id: string; name: string; status: ReviewStatus } | null>(null);
  // Which round's pick order / picks the two columns are showing -- an index
  // into `rounds`, independent of whose turn it actually is.
  const [roundPage, setRoundPage] = useState(0);
  // The exec is manually staging someone onto a project outside the normal
  // turn-based flow.
  const [addTarget, setAddTarget] = useState<{ roundProjectId: string; projectId: string; projectName: string } | null>(null);
  const [periodApplicants, setPeriodApplicants] = useState<{ id: string; name: string }[] | null>(null);
  const [addFilter, setAddFilter] = useState("");
  // Recruiting flags (infosesh / coffee / returning / board-exec) barely change
  // during a live draft; cache per period so realtime refreshes don't re-hit
  // the fat attendance/coffee queries on every tick.
  const recruitingCacheRef = useRef<{ periodId: string | null; byUser: Map<string, RecruitingFlags> }>({
    periodId: null,
    byUser: new Map(),
  });
  // Bumped on each loadBoard start; stale overlapping responses are ignored.
  const loadBoardGenRef = useRef(0);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const [{ data: periodRows }, { data: projectRows }] = await Promise.all([
        supabase
          .from("application_periods")
          .select("id, name, starts_at, ends_at, status")
          .order("created_at", { ascending: false }),
        supabase.from("projects").select(PROJECT_COLS).order("name"),
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
      .select(
        "id, round_number, draft_round_projects(id, project_id, pick_order, pick_count, projects(name, icon, icon_url, color, type, client, description, difficulty, estimated_members, num_subteams))",
      )
      .eq("period_id", periodId)
      .order("round_number");
    if (loadError) { setError("Couldn't load draft rounds."); setRounds([]); return; }

    type ProjRow = { name: string } & ProjectMeta;
    type RoundRow = {
      id: string;
      round_number: number;
      draft_round_projects: { id: string; project_id: string; pick_order: number; pick_count: number; projects: ProjRow | null }[];
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
          icon: rp.projects?.icon ?? null,
          icon_url: rp.projects?.icon_url ?? null,
          color: rp.projects?.color ?? null,
          type: rp.projects?.type ?? null,
          client: rp.projects?.client ?? null,
          description: rp.projects?.description ?? null,
          difficulty: rp.projects?.difficulty ?? null,
          estimated_members: rp.projects?.estimated_members ?? null,
          num_subteams: rp.projects?.num_subteams ?? null,
        })),
      ),
    }));
    setRounds(list);
  }, []);

  const loadDraftState = useCallback(async (periodId: string) => {
    const supabase = createClient();
    const { data } = await supabase.from("draft_state").select("current_pick_id, completed_at").eq("period_id", periodId).maybeSingle();
    setCurrentPickId(data?.current_pick_id ?? null);
    setCompletedAt(data?.completed_at ?? null);
  }, []);

  // Fetch recruiting flags only for user ids missing from the period cache.
  // Uses chunked dual `.in()` for infosesh (no doubled OR filter in the URL).
  const ensureRecruitingFlags = useCallback(async (periodId: string, userIds: string[]) => {
    const cache = recruitingCacheRef.current;
    if (cache.periodId !== periodId) {
      cache.periodId = periodId;
      cache.byUser = new Map();
    }
    const unique = [...new Set(userIds)];
    const missing = unique.filter((id) => !cache.byUser.has(id));
    if (missing.length === 0) return;

    const supabase = createClient();
    const returningUsers = new Set<string>();
    const coffeeDoneUsers = new Set<string>();
    const infoUsers = new Set<string>();
    const boardExecUsers = new Set<string>();
    const userName: Record<string, string> = {};

    const memberChunks = chunkIds(missing);
    const results = await Promise.all(
      memberChunks.flatMap((chunk) => [
        supabase.from("members").select("user_id, preferred_firstname, lastname, status").in("user_id", chunk),
        supabase.from("coffee_chats").select("applicant_id, complete").in("applicant_id", chunk),
        // Two queries instead of `.or(applicant_id.in.(…),member_id.in.(…))`
        // so each UUID appears once per request and URLs stay short.
        supabase.from("infosesh_attendance").select("applicant_id, member_id").in("applicant_id", chunk),
        supabase.from("infosesh_attendance").select("applicant_id, member_id").in("member_id", chunk),
        supabase
          .from("members_roles")
          .select("user_id, roles!inner(access_level)")
          .in("user_id", chunk)
          .in("roles.access_level", ["board", "exec"]),
      ]),
    );

    const idSet = new Set(missing);
    for (let i = 0; i < memberChunks.length; i++) {
      const base = i * 5;
      const mems = results[base]?.data;
      const chats = results[base + 1]?.data;
      const infoByApp = results[base + 2]?.data;
      const infoByMem = results[base + 3]?.data;
      const roleRows = results[base + 4]?.data;

      for (const m of (mems ?? []) as {
        user_id: string;
        preferred_firstname: string | null;
        lastname: string | null;
        status: string | null;
      }[]) {
        userName[m.user_id] = [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Applicant";
        if (m.status === "active" || m.status === "inactive") returningUsers.add(m.user_id);
      }
      for (const c of (chats ?? []) as { applicant_id: string | null; complete: boolean }[]) {
        if (c.complete && c.applicant_id) coffeeDoneUsers.add(c.applicant_id);
      }
      for (const r of [...(infoByApp ?? []), ...(infoByMem ?? [])] as {
        applicant_id: string | null;
        member_id: string | null;
      }[]) {
        if (r.applicant_id && idSet.has(r.applicant_id)) infoUsers.add(r.applicant_id);
        if (r.member_id && idSet.has(r.member_id)) infoUsers.add(r.member_id);
      }
      for (const r of (roleRows ?? []) as { user_id: string | null }[]) {
        if (r.user_id) boardExecUsers.add(r.user_id);
      }
    }

    for (const uid of missing) {
      cache.byUser.set(uid, {
        name: userName[uid] ?? "Applicant",
        returning: returningUsers.has(uid),
        coffeeDone: coffeeDoneUsers.has(uid),
        infosession: infoUsers.has(uid),
        boardExec: boardExecUsers.has(uid),
      });
    }
  }, []);

  // Lightweight, flash-free load for the live board (picks + submitted state +
  // applicant names). Doesn't touch the editable `rounds`, so it's safe to run
  // on every realtime event. Recruiting indicators are cached — only newly
  // seen applicant user ids hit members/coffee/infosesh/roles.
  const loadBoard = useCallback(async (periodId: string) => {
    const gen = ++loadBoardGenRef.current;
    const supabase = createClient();
    const { data: rpRows } = await supabase
      .from("draft_round_projects")
      .select("id, submitted_at, draft_picks(id, application_id), draft_rounds!inner(period_id)")
      .eq("draft_rounds.period_id", periodId);
    if (gen !== loadBoardGenRef.current) return;

    const rows = (rpRows ?? []) as unknown as {
      id: string;
      submitted_at: string | null;
      draft_picks: { id: string; application_id: string }[];
    }[];

    const nextBoard: Record<string, { submittedAt: string | null; appIds: string[] }> = {};
    const appIdSet = new Set<string>();
    for (const r of rows) {
      nextBoard[r.id] = { submittedAt: r.submitted_at, appIds: r.draft_picks.map((p) => p.application_id) };
      r.draft_picks.forEach((p) => appIdSet.add(p.application_id));
    }
    setBoardRows(nextBoard);

    if (appIdSet.size === 0) {
      setNameByAppId({});
      setStatusByAppId({});
      setIndByAppId({});
      setRankByAppProject({});
      return;
    }
    const appIds = [...appIdSet];
    const [apps, rankings] = await Promise.all([
      selectInChunks<{
        id: string;
        applicant_id: string | null;
        status: ReviewStatus;
        submitted_at: string | null;
      }>(appIds, (chunk) =>
        supabase.from("applications").select("id, applicant_id, status, submitted_at").in("id", chunk),
      ),
      selectInChunks<{ application_id: string; project_id: string; rank: number }>(appIds, (chunk) =>
        supabase
          .from("application_rankings")
          .select("application_id, project_id, rank")
          .in("application_id", chunk)
          .eq("ranked", true),
      ),
    ]);
    if (gen !== loadBoardGenRef.current) return;

    const nextRank: Record<string, number> = {};
    for (const r of rankings) {
      nextRank[`${r.application_id}:${r.project_id}`] = r.rank;
    }
    setRankByAppProject(nextRank);
    const appToUser: Record<string, string> = {};
    const submittedByApp: Record<string, string | null> = {};
    const nextStatus: Record<string, ReviewStatus> = {};
    const userIds: string[] = [];
    for (const a of apps) {
      nextStatus[a.id] = a.status;
      submittedByApp[a.id] = a.submitted_at;
      if (a.applicant_id) {
        appToUser[a.id] = a.applicant_id;
        userIds.push(a.applicant_id);
      }
    }
    setStatusByAppId(nextStatus);

    await ensureRecruitingFlags(periodId, userIds);
    if (gen !== loadBoardGenRef.current) return;

    const byUser = recruitingCacheRef.current.byUser;
    const nameByApp: Record<string, string> = {};
    const nextInd: Record<string, PickIndicators> = {};
    for (const appId of appIds) {
      const uid = appToUser[appId];
      const flags = uid ? byUser.get(uid) : undefined;
      nameByApp[appId] = flags?.name ?? "Applicant";
      const returning = !!flags?.returning;
      const valid = isRecruitingValid({
        boardExec: !!flags?.boardExec,
        returning,
        coffeeDone: !!flags?.coffeeDone,
        infosession: !!flags?.infosession,
      });
      nextInd[appId] = { returning, invalid: !valid, submittedAt: submittedByApp[appId] ?? null };
    }
    setNameByAppId(nameByApp);
    setIndByAppId(nextInd);
  }, [ensureRecruitingFlags]);

  useEffect(() => {
    setPeriodApplicants(null);
    setRoundPage(0);
    recruitingCacheRef.current = { periodId: null, byUser: new Map() };
    loadBoardGenRef.current += 1;
    if (selectedPeriodId) {
      loadRounds(selectedPeriodId);
      loadDraftState(selectedPeriodId);
      loadBoard(selectedPeriodId);
    } else {
      setRounds(null);
      setCurrentPickId(null);
      setCompletedAt(null);
      setBoardRows({});
      setNameByAppId({});
      setStatusByAppId({});
      setIndByAppId({});
      setRankByAppProject({});
    }
  }, [selectedPeriodId, loadRounds, loadDraftState, loadBoard]);


  // Live-refresh the draft state (whose turn / completed / reset) and the board
  // (who's picked what) as they move -- when a PM stages/submits or another
  // exec advances -- without a reload. Recruiting indicators stay cached so
  // infosesh/coffee aren't re-fetched every tick. The full editable rounds
  // structure is deliberately NOT reloaded here (it would flash a skeleton and
  // could interrupt setup edits in progress).
  const refreshLive = useCallback(() => {
    if (!selectedPeriodId) return;
    loadDraftState(selectedPeriodId);
    loadBoard(selectedPeriodId);
  }, [selectedPeriodId, loadDraftState, loadBoard]);
  useDraftRealtime(selectedPeriodId, refreshLive);

  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId) ?? null;

  // The order picks actually happen in: every round in order, each round's
  // projects in pick_order, skipping any project sitting out (pick_count 0).
  const sequence: PickStop[] = (rounds ?? []).flatMap((r) =>
    r.projects.filter((p) => p.pick_count > 0).map((p) => ({ ...p, round_id: r.id, round_number: r.round_number })),
  );
  const currentIndex = currentPickId ? sequence.findIndex((s) => s.id === currentPickId) : -1;
  const currentStop = currentIndex >= 0 ? sequence[currentIndex] : null;

  // Keep the round pager pointed at whichever round is actually on the clock
  // -- but only when the turn moves into a *different* round, so browsing
  // elsewhere while it's still that round's turn isn't fought on every render.
  const lastTurnRoundId = useRef<string | null>(null);
  useEffect(() => {
    const roundId = currentStop?.round_id ?? null;
    if (roundId && roundId !== lastTurnRoundId.current) {
      const idx = (rounds ?? []).findIndex((r) => r.id === roundId);
      if (idx >= 0) setRoundPage(idx);
    }
    lastTurnRoundId.current = roundId;
  }, [currentStop?.round_id, rounds]);

  // Keep the page in range as rounds are added/removed.
  useEffect(() => {
    if (!rounds) return;
    setRoundPage((p) => Math.min(Math.max(p, 0), Math.max(rounds.length - 1, 0)));
  }, [rounds]);

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

  // Wipes every staged/confirmed pick for the period and un-submits every
  // round before clearing the position -- since placement is deferred to
  // completeDraft(), nothing on applications/project_members needs
  // undoing here; a reset genuinely sends everyone back to plain
  // applicants. Goes through the RPC (not a plain draft_state upsert)
  // because RLS blocks deleting draft_picks under an already-submitted
  // round for anyone but this SECURITY DEFINER function.
  const resetDraft = async () => {
    if (!selectedPeriodId) return;
    setWorking(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("reset_draft", { p_period_id: selectedPeriodId });
      if (rpcError) { setError(rpcError.message || "Couldn't reset the draft."); return; }
      setCurrentPickId(null);
    } finally {
      setWorking(false);
    }
  };

  // Places every confirmed pick in the period onto its project for real
  // (accept_application under the hood) and locks the draft as completed.
  const completeDraft = async () => {
    if (!selectedPeriodId) return;
    setWorking(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("complete_draft", { p_period_id: selectedPeriodId });
      if (rpcError) { setError(rpcError.message || "Couldn't complete the draft."); return; }
      loadDraftState(selectedPeriodId);
    } finally {
      setWorking(false);
    }
  };

  // Flips one project's round between confirmed/staged directly, regardless
  // of whose turn it is -- an admin correction tool, distinct from the
  // turn-gated submit_draft_picks PMs use. Only touches that one
  // draft_round_projects row: no picks are deleted and current_pick_id is
  // left alone.
  const setRoundSubmitted = async (roundProjectId: string, submitted: boolean) => {
    if (!selectedPeriodId) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_round_submitted", {
      p_round_project_id: roundProjectId,
      p_submitted: submitted,
    });
    if (rpcError) { setError(rpcError.message || "Couldn't update that round."); return; }
    loadBoard(selectedPeriodId);
  };

  // Loaded lazily the first time the "add manually" picker opens for a
  // period, then reused -- every project's round shares the same roster.
  const loadPeriodApplicants = async () => {
    if (!selectedPeriodId) return;
    const supabase = createClient();
    const { data: apps } = await supabase
      .from("applications")
      .select("id, applicant_id")
      .eq("period_id", selectedPeriodId)
      .in("status", ["submitted", "accepted", "rejected"]);
    const rows = (apps ?? []) as { id: string; applicant_id: string | null }[];
    const userIds = [...new Set(rows.map((r) => r.applicant_id).filter((id): id is string => !!id))];
    const { data: mems } = userIds.length
      ? await supabase.from("members").select("user_id, preferred_firstname, lastname").in("user_id", userIds)
      : { data: [] as { user_id: string; preferred_firstname: string | null; lastname: string | null }[] };
    const nameByUser: Record<string, string> = {};
    for (const m of (mems ?? []) as { user_id: string; preferred_firstname: string | null; lastname: string | null }[]) {
      nameByUser[m.user_id] = [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Applicant";
    }
    setPeriodApplicants(
      rows.map((r) => ({ id: r.id, name: (r.applicant_id && nameByUser[r.applicant_id]) || "Applicant" })).sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  const openAddManually = (roundProjectId: string, projectId: string, projectName: string) => {
    setAddFilter("");
    setAddTarget({ roundProjectId, projectId, projectName });
    if (!periodApplicants) loadPeriodApplicants();
  };

  const addApplicantManually = async (applicationId: string) => {
    if (!addTarget || !selectedPeriodId) return;
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("draft_picks")
      .insert({ round_project_id: addTarget.roundProjectId, application_id: applicationId });
    if (insertError) { setError(insertError.message || "Couldn't add that applicant."); return; }
    setAddTarget(null);
    loadBoard(selectedPeriodId);
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
        seededRows = (rpRows ?? []).map((rp) => {
          const p = seed.find((sp) => sp.id === rp.project_id);
          return {
            id: rp.id,
            project_id: rp.project_id,
            name: p?.name ?? "Untitled project",
            pick_order: rp.pick_order,
            pick_count: rp.pick_count,
            ...projectMeta(p),
          };
        });
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
    setRounds((prev) => {
      const next = prev?.filter((r) => r.id !== roundId) ?? null;
      if (next && next.length > 0) setRoundPage((p) => Math.min(p, next.length - 1));
      else setRoundPage(0);
      return next;
    });
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
                { id: data.id, project_id: project.id, name: project.name, pick_order: data.pick_order, pick_count: data.pick_count, ...projectMeta(project) },
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
          {completedAt ? (
            <div className="flex items-center gap-2 text-sm">
              <CheckCheck size={16} className="text-green-600" />
              <span>
                Draft completed — every confirmed pick has been placed on its project
                <span className="text-muted-foreground"> ({new Date(completedAt).toLocaleString()})</span>.
              </span>
            </div>
          ) : currentStop === null ? (
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
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-600/90"
                  onClick={() => setConfirmTarget({ kind: "complete" })}
                  disabled={working}
                >
                  <CheckCheck size={14} className="mr-1.5" />
                  Complete draft
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setConfirmTarget({ kind: "reset" })}
                  disabled={working}
                >
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
          {rounds !== null && rounds.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={roundPage <= 0}
                  onClick={() => setRoundPage((p) => p - 1)}
                >
                  <ChevronLeft size={14} />
                </Button>
                <span className="text-base font-bold text-foreground">
                  Round {roundPage + 1} of {rounds.length}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={roundPage >= rounds.length - 1}
                  onClick={() => setRoundPage((p) => p + 1)}
                >
                  <ChevronRight size={14} />
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label="Delete this round"
                      onClick={() => {
                        const round = rounds[roundPage];
                        if (!round) return;
                        setConfirmTarget({ kind: "round", roundId: round.id, label: `Round ${round.round_number}` });
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Delete this round and its pick order
                  </TooltipContent>
                </Tooltip>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const nextPage = rounds.length;
                  await addRound();
                  setRoundPage(nextPage);
                }}
              >
                <Plus size={14} className="mr-1.5" />
                Add round
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {/* LEFT: the single, editable pick-order box for the active round */}
            {rounds === null ? (
              <div className="h-24 rounded-xl bg-muted animate-pulse" />
            ) : rounds.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl flex flex-col gap-3 items-center">
                No rounds yet. Add one to start setting up the draft.
                <Button variant="outline" size="sm" onClick={addRound}>
                  <Plus size={14} className="mr-1.5" />
                  Add round
                </Button>
              </div>
            ) : (
              (() => {
                const round = rounds[roundPage];
                if (!round) return null;
                return (
                  <RoundCard
                    round={round}
                    currentPickId={currentPickId}
                    boardRows={boardRows}
                    addableProjects={(allProjects ?? []).filter((p) => !round.projects.some((rp) => rp.project_id === p.id))}
                    onAddProject={(project) => addProjectToRound(round.id, project)}
                    onRemoveProject={(rp) =>
                      setConfirmTarget({ kind: "project", roundId: round.id, rowId: rp.id, label: rp.name })
                    }
                    onReorder={(event) => reorderRound(round.id, event)}
                    onPickCountChange={(rowId, value) => updatePickCount(round.id, rowId, value)}
                    onPickCountCommit={commitPickCount}
                    onOpenInfo={setInfoProject}
                  />
                );
              })()
            )}

            {/* RIGHT: who's picked what, for the same active round */}
            {rounds !== null && rounds.length > 0 && rounds[roundPage] && (
              <PicksThisRound
                round={rounds[roundPage]}
                boardRows={boardRows}
                nameByAppId={nameByAppId}
                indByAppId={indByAppId}
                rankByAppProject={rankByAppProject}
                periodEndsAt={selectedPeriod?.ends_at}
                currentPickId={currentPickId}
                started={currentPickId !== null || !!completedAt}
                onOpenApplicant={(appId) =>
                  setReviewFor({ id: appId, name: nameByAppId[appId] ?? "Applicant", status: statusByAppId[appId] ?? "submitted" })
                }
                onRequestUnsubmit={(roundProjectId, label) => setConfirmTarget({ kind: "unsubmit", roundProjectId, label })}
                onSetSubmitted={setRoundSubmitted}
                onAddManually={openAddManually}
              />
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        title={
          confirmTarget?.kind === "round" ? `Delete ${confirmTarget.label}?`
          : confirmTarget?.kind === "project" ? `Remove ${confirmTarget.label}?`
          : confirmTarget?.kind === "reset" ? "Reset the draft?"
          : confirmTarget?.kind === "unsubmit" ? `Send ${confirmTarget.label}'s picks back to staged?`
          : "Complete the draft?"
        }
        description={
          confirmTarget?.kind === "round" ? "This removes the round and every project's order/pick count within it."
          : confirmTarget?.kind === "project" ? "This project will no longer draft in this round."
          : confirmTarget?.kind === "reset"
            ? "Every staged and confirmed pick this draft is cleared and every round un-submitted. Applicants go back to being plain applicants — nothing has been placed on a project yet, so there's nothing to undo there. Round order and pick counts are unaffected."
          : confirmTarget?.kind === "unsubmit"
            ? "This project's confirmed picks for this round go back to staged. Nothing is deleted — round order, pick counts, and every other project are unaffected."
            : "Places every confirmed pick onto its project for real (same as accepting them manually) and locks the draft. This can't be undone from here."
        }
        confirmLabel={
          confirmTarget?.kind === "round" ? "Delete round"
          : confirmTarget?.kind === "project" ? "Remove"
          : confirmTarget?.kind === "reset" ? "Reset draft"
          : confirmTarget?.kind === "unsubmit" ? "Send back to staged"
          : "Complete draft"
        }
        destructive={confirmTarget?.kind !== "complete"}
        onConfirm={() => {
          if (!confirmTarget) return;
          if (confirmTarget.kind === "round") return deleteRound(confirmTarget.roundId);
          if (confirmTarget.kind === "project") return removeProjectFromRound(confirmTarget.roundId, confirmTarget.rowId);
          if (confirmTarget.kind === "reset") return resetDraft();
          if (confirmTarget.kind === "unsubmit") return setRoundSubmitted(confirmTarget.roundProjectId, false);
          return completeDraft();
        }}
      />

      {addTarget && (
        <AddApplicantModal
          target={addTarget}
          applicants={periodApplicants}
          alreadyPicked={boardRows[addTarget.roundProjectId]?.appIds ?? []}
          filter={addFilter}
          onFilterChange={setAddFilter}
          onPick={addApplicantManually}
          onClose={() => setAddTarget(null)}
        />
      )}

      <ProjectInfoModal project={infoProject} onClose={() => setInfoProject(null)} />

      {reviewFor && (
        <ApplicationReviewModal
          applicationId={reviewFor.id}
          applicantName={reviewFor.name}
          status={reviewFor.status}
          contextProjectId={null}
          readOnly
          open={!!reviewFor}
          onOpenChange={(o) => { if (!o) setReviewFor(null); }}
          onReviewed={() => {}}
        />
      )}
    </div>
  );
}

// A small square icon button, matching the overlay-button styling used for
// per-card actions elsewhere (applicant-meta.tsx's OverlayButton) -- inlined
// here since this panel's cards are plain, non-draggable divs rather than the
// sortable applicant cards that version is built for.
function IconButton({
  onClick,
  disabled,
  label,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

// The "picks this round" column: every project in the active round (even
// ones with nothing picked yet), staged vs confirmed, with clickable
// applicant names (open the global, view-only application card) and, per
// project, admin controls to send confirmed picks back to staged, flip a
// pick's badge directly, or manually stage an applicant.
function PicksThisRound({
  round,
  boardRows,
  nameByAppId,
  indByAppId,
  rankByAppProject,
  periodEndsAt,
  currentPickId,
  started,
  onOpenApplicant,
  onRequestUnsubmit,
  onSetSubmitted,
  onAddManually,
}: {
  round: Round;
  boardRows: Record<string, { submittedAt: string | null; appIds: string[] }>;
  nameByAppId: Record<string, string>;
  indByAppId: Record<string, PickIndicators>;
  rankByAppProject: Record<string, number>;
  periodEndsAt: string | undefined;
  currentPickId: string | null;
  started: boolean;
  onOpenApplicant: (appId: string) => void;
  onRequestUnsubmit: (roundProjectId: string, label: string) => void;
  onSetSubmitted: (roundProjectId: string, submitted: boolean) => void;
  onAddManually: (roundProjectId: string, projectId: string, projectName: string) => void;
}) {
  return (
    <div className="border rounded-xl p-4 flex flex-col gap-3">
      {!started ? (
        <p className="text-xs text-muted-foreground py-2">The draft hasn&apos;t started yet — picks appear here as they&apos;re staged.</p>
      ) : round.projects.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No projects in this round.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {round.projects.map((rp) => {
            const row = boardRows[rp.id] ?? { submittedAt: null, appIds: [] };
            const confirmed = !!row.submittedAt;
            const isFull = row.appIds.length >= rp.pick_count;
            return (
              <div
                key={rp.id}
                className={`flex flex-col gap-1.5 rounded-lg border p-2 ${
                  rp.id === currentPickId ? "border-primary ring-1 ring-primary" : "border-transparent"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ProjectIcon project={rp} className="h-5 w-5" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">{rp.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmed && (
                      <IconButton label="Send back to staged" onClick={() => onRequestUnsubmit(rp.id, rp.name)}>
                        <Undo2 size={14} />
                      </IconButton>
                    )}
                    <IconButton
                      label={confirmed ? "Unsubmit this round to add more" : isFull ? "This round is full" : "Add applicant manually"}
                      disabled={confirmed || isFull}
                      onClick={() => onAddManually(rp.id, rp.project_id, rp.name)}
                    >
                      <Plus size={14} />
                    </IconButton>
                  </div>
                </div>
                {row.appIds.length === 0 ? (
                  <p className="px-1 py-1 text-xs text-muted-foreground">No picks yet.</p>
                ) : (
                  row.appIds.map((appId, i) => {
                    const ind = indByAppId[appId];
                    const rank = rankByAppProject[`${appId}:${rp.project_id}`] ?? 0;
                    return (
                      <div key={`${appId}-${i}`} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm bg-background">
                        <button
                          type="button"
                          onClick={() => onOpenApplicant(appId)}
                          className="min-w-0 truncate text-left font-medium hover:underline"
                        >
                          {nameByAppId[appId] ?? "Applicant"}
                        </button>
                        {rank > 0 && (
                          <span
                            className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70"
                            title={rankLabel(rank)}
                          >
                            {rankLabel(rank).split(" ")[0]}
                          </span>
                        )}
                        {ind && <InvalidIndicator valid={!ind.invalid} />}
                        {ind && <ReturningIndicator returning={ind.returning} />}
                        <LateBadge submittedAt={ind?.submittedAt} endsAt={periodEndsAt} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            {confirmed ? (
                              <Badge className="ml-auto inline-flex items-center gap-1 bg-green-600 hover:bg-green-600 shrink-0 cursor-pointer">
                                <ChevronDown size={12} className="opacity-80" />
                                Confirmed
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="ml-auto inline-flex items-center gap-1 shrink-0 cursor-pointer">
                                <ChevronDown size={12} className="opacity-60" />
                                Staged
                              </Badge>
                            )}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onSetSubmitted(rp.id, true)}>
                              {confirmed && <Check size={14} className="mr-2" />} Confirmed
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onSetSubmitted(rp.id, false)}>
                              {!confirmed && <Check size={14} className="mr-2" />} Staged
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The exec's manual-staging picker: any applicant this period, minus whoever
// is already picked for this round-project. Bypasses the normal turn-based
// flow entirely, same as the admin unsubmit/confirm controls above.
function AddApplicantModal({
  target,
  applicants,
  alreadyPicked,
  filter,
  onFilterChange,
  onPick,
  onClose,
}: {
  target: { roundProjectId: string; projectId: string; projectName: string };
  applicants: { id: string; name: string }[] | null;
  alreadyPicked: string[];
  filter: string;
  onFilterChange: (value: string) => void;
  onPick: (applicationId: string) => void;
  onClose: () => void;
}) {
  const pickedSet = new Set(alreadyPicked);
  const options = (applicants ?? []).filter(
    (a) => !pickedSet.has(a.id) && a.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to {target.projectName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Search applicants…"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
          />
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {applicants === null ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading applicants…</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No matching applicants.</p>
            ) : (
              options.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onPick(a.id)}
                  className="rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {a.name}
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A read-only project detail popup opened from a pick-order tile.
function ProjectInfoModal({ project, onClose }: { project: RoundProject | null; onClose: () => void }) {
  const facts: [string, string][] = project
    ? [
        ["Type", project.type === "studio" ? "OP Studio" : project.type === "launch" ? "OP Launch" : "—"],
        ["Client", project.client || "—"],
        ["Difficulty", project.difficulty ? project.difficulty[0].toUpperCase() + project.difficulty.slice(1) : "—"],
        ["Est. team size", project.estimated_members != null ? String(project.estimated_members) : "—"],
        ["Subteams", project.num_subteams != null ? String(project.num_subteams) : "—"],
      ]
    : [];
  return (
    <Dialog open={!!project} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {project && <ProjectIcon project={project} className="h-7 w-7" />}
            <span className="truncate">{project?.name}</span>
          </DialogTitle>
        </DialogHeader>
        {project && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
            {project.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{project.description}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoundCard({
  round,
  currentPickId,
  boardRows,
  addableProjects,
  onAddProject,
  onRemoveProject,
  onReorder,
  onPickCountChange,
  onPickCountCommit,
  onOpenInfo,
}: {
  round: Round;
  currentPickId: string | null;
  boardRows: Record<string, { submittedAt: string | null; appIds: string[] }>;
  addableProjects: Project[];
  onAddProject: (project: Project) => void;
  onRemoveProject: (rp: RoundProject) => void;
  onReorder: (event: DragEndEvent) => void;
  onPickCountChange: (rowId: string, value: number) => void;
  onPickCountCommit: (rowId: string, value: number) => void;
  onOpenInfo: (rp: RoundProject) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
    <div className="border rounded-xl p-4 flex flex-col gap-3">
      {addableProjects.length > 0 && (
        <div className="flex items-center justify-end">
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
        </div>
      )}

      {round.projects.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground border rounded-lg">
          No projects in this round.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
          <SortableContext items={round.projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {round.projects.map((rp, i) => (
                <ProjectTile
                  key={rp.id}
                  rp={rp}
                  position={i + 1}
                  isCurrent={rp.id === currentPickId}
                  board={boardRows[rp.id]}
                  onOpenInfo={() => onOpenInfo(rp)}
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

// One project's tile within a round's grid: icon + name (click → info),
// accent color, an editable pick count, a remove ×, and a grip handle that owns
// the drag (so clicking the tile body opens info instead of starting a drag).
function ProjectTile({
  rp,
  position,
  isCurrent,
  board,
  onOpenInfo,
  onRemove,
  onPickCountChange,
  onPickCountCommit,
}: {
  rp: RoundProject;
  position: number;
  isCurrent: boolean;
  board: { submittedAt: string | null; appIds: string[] } | undefined;
  onOpenInfo: () => void;
  onRemove: () => void;
  onPickCountChange: (value: number) => void;
  onPickCountCommit: (value: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rp.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    borderLeftColor: rp.color || undefined,
  };
  const stagedCount = board?.appIds.length ?? 0;
  const confirmed = !!board?.submittedAt;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border border-l-4 px-2.5 py-2 bg-background ${
        isCurrent ? "border-primary ring-1 ring-primary" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab touch-none shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>
      <span className="w-4 shrink-0 text-xs font-medium text-muted-foreground">{position}.</span>
      <button
        type="button"
        onClick={onOpenInfo}
        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
        title={`${rp.name} — details`}
      >
        <ProjectIcon project={rp} className="h-6 w-6" />
        <span className="truncate text-sm font-medium">{rp.name}</span>
      </button>
      {confirmed ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-green-600">
          <Check size={13} /> Confirmed
        </span>
      ) : stagedCount > 0 ? (
        <span className="shrink-0 text-xs text-muted-foreground">{stagedCount} staged</span>
      ) : null}
      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        Picks
        <Input
          type="number"
          min={0}
          value={rp.pick_count}
          onChange={(e) => onPickCountChange(Number(e.target.value))}
          onBlur={(e) => onPickCountCommit(Number(e.target.value))}
          className="h-7 w-14 px-2 text-xs"
        />
      </label>
      <button
        onClick={onRemove}
        className="text-muted-foreground/50 hover:text-destructive shrink-0"
        aria-label={`Remove ${rp.name} from this round`}
      >
        <X size={15} />
      </button>
    </div>
  );
}
