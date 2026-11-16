"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, X, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

import { Skeleton } from "@/components/ui/skeleton";
import { resumeSignedUrl } from "@/lib/resume-upload";
import { TechAreaIcon } from "@/components/tech-area-icon";
import { techAreaLabel, techClassLabel } from "@/lib/application-profile";
import { LateBadge } from "@/components/applicant-indicators";
import { coffeeChatLabel, type CoffeeState } from "@/lib/coffee-chat-indicator";
import { Coffee, Presentation, RotateCcw } from "lucide-react";

// What the applicant rows used to carry as icons; now said once, in words,
// inside the application.
export type RecruitingFacts = {
  coffee?: CoffeeState | null;
  coffeeWith?: string[] | null;
  returning?: boolean;
  infosession?: boolean;
};

function RecruitingLine({ facts, lateBadge }: { facts?: RecruitingFacts; lateBadge: React.ReactNode }) {
  const items: React.ReactNode[] = [];
  if (facts?.returning) {
    items.push(
      <span key="ret" className="inline-flex items-center gap-1 text-info">
        <RotateCcw size={13} aria-hidden /> Returning member
      </span>,
    );
  }
  if (facts?.coffee && facts.coffee !== "none") {
    const done = facts.coffee === "done";
    items.push(
      <span key="coffee" className={`inline-flex items-center gap-1 ${done ? "text-success" : "text-warning"}`}>
        <Coffee size={13} aria-hidden /> {coffeeChatLabel(facts.coffee, facts.coffeeWith)}
      </span>,
    );
  } else if (facts && facts.coffee !== undefined && !facts.returning) {
    items.push(
      <span key="coffee" className="inline-flex items-center gap-1 text-muted-foreground">
        <Coffee size={13} aria-hidden /> No coffee chat
      </span>,
    );
  }
  if (facts?.infosession) {
    items.push(
      <span key="info" className="inline-flex items-center gap-1 text-info">
        <Presentation size={13} aria-hidden /> Attended an info session
      </span>,
    );
  } else if (facts && facts.infosession === false && !facts.returning) {
    items.push(
      <span key="info" className="inline-flex items-center gap-1 text-muted-foreground">
        <Presentation size={13} aria-hidden /> No info session
      </span>,
    );
  }
  if (lateBadge) items.push(<span key="late">{lateBadge}</span>);
  if (items.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium">{items}</div>;
}
import { optimistic } from "@/lib/optimistic";
import { useConfirm } from "@/components/ui/use-confirm";

export type ReviewStatus = "submitted" | "accepted" | "rejected";

// A section of the application the modal can open scrolled to, so a click on a
// sheet-view cell lands on the answer it was showing. "essay" resolves to the
// ranking section for `contextProjectId`.
export type FocusSection = "areas" | "classes" | "essay";

// Temporarily disables Accept and Reject so nobody decides an applicant's
// outcome early while project assignments are still being finalized.
// Reviewing (reading the application) stays available. Flip back to true
// once decisions should reopen.
const DECISIONS_ENABLED = false;

// Transient highlight on a section the modal was opened straight to.
const FLASH_RING = "ring-2 ring-ring ring-offset-4 ring-offset-background";

const PROJECT_TYPE_LABELS: Record<string, string> = {
  studio: "OP Studio",
  launch: "OP Launch",
};

type RankingRow = {
  id: string;
  rank: number;
  essay: string | null;
  project: { id: string; name: string; type: string } | null;
};

type AnswerRow = {
  ranking_id: string;
  answer: string | null;
  answer_options: string[] | null;
  question: { id: string; prompt: string; position: number } | null;
};

// The applicant's optional "About you" answers (on the application) + their
// uploaded resume (member-level, in the private bucket).
type Profile = {
  tech_area_rankings: Record<string, number> | null;
  tech_classes: string[] | null;
  tech_classes_other: string | null;
  about_note: string | null;
  portfolio_url: string | null;
  resume_path: string | null;
  resume_filename: string | null;
};

// Board/exec review of one submitted application: read the applicant's ranked
// projects + essays + answers, then accept (placing them on a chosen project via
// the accept_application RPC) or reject. `onReviewed` reports the new status so
// the list can update in place.
export function ApplicationReviewModal({
  applicationId,
  applicantName,
  status,
  contextProjectId,
  focus,
  open,
  onOpenChange,
  onReviewed,
  readOnly = false,
  recruiting,
}: {
  applicationId: string;
  applicantName: string;
  status: ReviewStatus;
  // The project the reviewer is currently reviewing under (the manager page's
  // project picker). Board/exec (including PMs) can read every ranked project's
  // responses (0087); this still defaults the "Place on" dropdown and drives
  // the "Jump to" pill when more than one ranking is visible.
  contextProjectId?: string | null;
  // Scroll to (and briefly highlight) this section once the application loads.
  focus?: FocusSection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReviewed: (status: ReviewStatus) => void;
  // View-only: hide the Place-on / Reject / Accept footer (e.g. the exec draft
  // board, which just surfaces application info -- placement happens via the
  // draft flow, not manual accept/reject).
  readOnly?: boolean;
  // Returning / coffee / info session, from the row that opened this.
  recruiting?: RecruitingFacts;
}) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [answersByRanking, setAnswersByRanking] = useState<Record<string, AnswerRow[]>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [periodEndsAt, setPeriodEndsAt] = useState<string | null>(null);
  const [resumeOpening, setResumeOpening] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const working = false;
  const [error, setError] = useState<string | null>(null);
  // Default true = hidden, so the "Jump to" pill never flashes when the PM's
  // project is already on screen; the observer reveals it a frame later if the
  // section is actually scrolled out of view.
  const [targetInView, setTargetInView] = useState(true);
  // Ring-highlights the section we jumped to, cleared on a timeout.
  const [flash, setFlash] = useState<FocusSection | null>(null);

  // contentRef is the scroll viewport (DialogContent, which is overflow-y-auto);
  // targetRef marks the PM's own project section — the jump destination and the
  // element the IntersectionObserver watches.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);

  const openResume = async () => {
    if (!profile?.resume_path) return;
    setResumeOpening(true);
    const url = await resumeSignedUrl(createClient(), profile.resume_path);
    setResumeOpening(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("Couldn't open the resume.");
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    // Reset so a prior applicant's "visible" state can't flash the pill before
    // the observer re-evaluates this applicant's sections.
    setTargetInView(true);
    const supabase = createClient();

    const load = async () => {
      // "About you" answers are on the application; the resume is member-level.
      // applicant_id is the auth user id (no FK to `members`), so read the resume
      // in a second query keyed on members.user_id.
      const { data: appRow } = await supabase
        .from("applications")
        .select("applicant_id, tech_area_rankings, tech_classes, tech_classes_other, about_note, portfolio_url, submitted_at, period:application_periods(ends_at)")
        .eq("id", applicationId)
        .maybeSingle();
      // The period embed is to-one; Supabase types it loosely, so accept either shape.
      const period = appRow?.period as { ends_at: string } | { ends_at: string }[] | null | undefined;
      setSubmittedAt((appRow?.submitted_at as string | null) ?? null);
      setPeriodEndsAt(Array.isArray(period) ? period[0]?.ends_at ?? null : period?.ends_at ?? null);
      let applicant: { resume_path: string | null; resume_filename: string | null } | null = null;
      if (appRow?.applicant_id) {
        const { data: mem } = await supabase
          .from("members")
          .select("resume_path, resume_filename")
          .eq("user_id", appRow.applicant_id as string)
          .maybeSingle();
        applicant = (mem as { resume_path: string | null; resume_filename: string | null } | null) ?? null;
      }
      setProfile(
        appRow
          ? {
              tech_area_rankings: (appRow.tech_area_rankings as Record<string, number> | null) ?? null,
              tech_classes: (appRow.tech_classes as string[] | null) ?? null,
              tech_classes_other: (appRow.tech_classes_other as string | null) ?? null,
              about_note: (appRow.about_note as string | null) ?? null,
              portfolio_url: (appRow.portfolio_url as string | null) ?? null,
              resume_path: applicant?.resume_path ?? null,
              resume_filename: applicant?.resume_filename ?? null,
            }
          : null,
      );

      const { data: rankRows } = await supabase
        .from("application_rankings")
        .select("id, rank, essay, project:projects(id, name, type)")
        .eq("application_id", applicationId)
        .eq("ranked", true)
        .order("rank");

      const rows = (rankRows ?? []) as unknown as RankingRow[];
      setRankings(rows);
      const defaultProjectId = rows.some((r) => r.project?.id === contextProjectId)
        ? contextProjectId!
        : (rows[0]?.project?.id ?? null);
      setSelectedProjectId(defaultProjectId);

      const ids = rows.map((r) => r.id);
      const grouped: Record<string, AnswerRow[]> = {};
      if (ids.length) {
        const { data: answerRows } = await supabase
          .from("application_answers")
          .select("ranking_id, answer, answer_options, question:project_questions(id, prompt, position)")
          .in("ranking_id", ids);
        for (const a of (answerRows ?? []) as unknown as AnswerRow[]) {
          (grouped[a.ranking_id] ??= []).push(a);
        }
        for (const id of Object.keys(grouped)) {
          grouped[id].sort((x, y) => (x.question?.position ?? 0) - (y.question?.position ?? 0));
        }
      }
      setAnswersByRanking(grouped);
      setLoading(false);
    };

    load();
  }, [open, applicationId, contextProjectId]);

  const selectedProject = rankings.find((r) => r.project?.id === selectedProjectId)?.project ?? null;

  // The PM's own project on this application — the "Jump to" destination.
  const targetRanking = rankings.find((r) => r.project?.id === contextProjectId) ?? null;
  const targetProjectName = targetRanking?.project?.name ?? null;
  // Show the floating pill only when the PM's section exists, there's more than
  // one ranking to scroll past, and that section isn't currently on screen.
  const showJump = !loading && !!targetRanking && rankings.length > 1 && !targetInView;

  // Watch the PM's project section; hide the pill while it's visible in the
  // modal's scroll viewport, show it again when it scrolls back out.
  useEffect(() => {
    const root = contentRef.current;
    const target = targetRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => setTargetInView(entries[0]?.isIntersecting ?? true),
      { root, threshold: 0.15 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loading, rankings.length, contextProjectId]);

  // Opened from a sheet-view cell: scroll that answer into view once the content
  // is rendered. A missing section (blank classes, no essay) just leaves the
  // modal at the top rather than jumping somewhere arbitrary.
  useEffect(() => {
    if (!open || loading || !focus) return;
    const root = contentRef.current;
    const el =
      focus === "essay"
        ? targetRef.current
        : root?.querySelector<HTMLElement>(`[data-section="${focus}"]`) ?? null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(focus);
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [open, loading, focus, applicationId]);

  // Both close the modal at once and decide in the background. The parent's
  // onReviewed re-reads roster/board/stats, so it runs once the RPC lands; a
  // refusal toasts (with Retry) instead of trapping the reviewer in the modal.
  const decide = (outcome: "accepted" | "rejected", projectId: string | null) => {
    setError(null);
    const supabase = createClient();
    void optimistic({
      label: outcome === "accepted" ? `acceptance of ${applicantName}` : `rejection of ${applicantName}`,
      key: `review:${applicationId}`,
      apply: () => onOpenChange(false),
      rollback: () => {},
      commit: () =>
        outcome === "accepted"
          ? supabase.rpc("accept_application", { p_application_id: applicationId, p_project_id: projectId })
          : supabase.rpc("reject_application", { p_application_id: applicationId }),
      onCommitted: () => onReviewed(outcome),
    });
  };

  const accept = () => {
    if (!selectedProjectId) { setError("Pick a project to place them on."); return; }
    decide("accepted", selectedProjectId);
  };

  const reject = () => {
    ask({
      title: `Reject ${applicantName}'s application?`,
      confirmLabel: "Reject",
      destructive: true,
      run: () => decide("rejected", null),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {confirmDialog}
      <DialogContent ref={contentRef} className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {applicantName}
            {status === "accepted" && <span className="text-sm font-medium text-success">· Accepted</span>}
            {status === "rejected" && <span className="text-sm font-medium text-destructive">· Rejected</span>}
          </DialogTitle>
          <RecruitingLine
            facts={recruiting}
            lateBadge={<LateBadge submittedAt={submittedAt} endsAt={periodEndsAt} className="text-xs" />}
          />
        </DialogHeader>

        {loading ? (
          <ApplicationReviewSkeleton readOnly={readOnly} />
        ) : (
          <div className="flex flex-col gap-6">
            <ApplicantDetails
              profile={profile}
              onOpenResume={openResume}
              resumeOpening={resumeOpening}
              flash={flash}
            />

            {rankings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ranked projects on this application.</p>
            ) : (
              rankings.map((r) => (
                <div
                  key={r.id}
                  ref={r.project?.id === contextProjectId ? targetRef : undefined}
                  className={cn(
                    "flex flex-col gap-2 scroll-mt-2 rounded-lg transition-shadow",
                    flash === "essay" && r.project?.id === contextProjectId && FLASH_RING,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 font-mono text-xs font-semibold text-muted-foreground tabular-nums">
                      {r.rank}.
                    </span>
                    <span className="text-sm font-semibold">{r.project?.name ?? "Unknown project"}</span>
                    {r.project?.type && (
                      <span className="text-xs text-muted-foreground">
                        {PROJECT_TYPE_LABELS[r.project.type] ?? r.project.type}
                      </span>
                    )}
                  </div>
                  {r.essay ? (
                    <p className="text-sm whitespace-pre-wrap text-foreground/90">{r.essay}</p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No essay.</p>
                  )}
                  {(answersByRanking[r.id] ?? []).map((a, i) => {
                    const value = a.answer_options?.length
                      ? a.answer_options.join(", ")
                      : a.answer ?? "";
                    return (
                      <div key={i} className="flex flex-col gap-0.5 pl-2 border-l border-foreground/10">
                        <span className="text-xs font-medium text-muted-foreground pl-2 whitespace-pre-wrap">
                          {a.question?.prompt}
                        </span>
                        <span className="text-sm pl-2 whitespace-pre-wrap">
                          {value || <span className="italic text-muted-foreground">No answer.</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {!readOnly && (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <span className="mr-auto text-xs text-muted-foreground">Place on</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors min-w-[10rem]">
                    {selectedProject?.name ?? <span className="text-muted-foreground">Select project…</span>}
                    <ChevronDown size={14} className="text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {rankings
                    .filter((r) => r.project)
                    .map((r) => (
                      <DropdownMenuItem key={r.project!.id} onSelect={() => setSelectedProjectId(r.project!.id)}>
                        <span className="tabular-nums text-muted-foreground mr-2">{r.rank}.</span>
                        {r.project!.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                onClick={reject}
                disabled={working || !DECISIONS_ENABLED}
                title={DECISIONS_ENABLED ? undefined : "Review decisions are temporarily disabled"}
              >
                <X size={16} className="mr-1" />
                Reject
              </Button>
              <Button
                onClick={accept}
                disabled={working || !selectedProjectId || !DECISIONS_ENABLED}
                title={DECISIONS_ENABLED ? undefined : "Review decisions are temporarily disabled"}
              >
                <Check size={16} className="mr-1" />
                {working ? "Working…" : "Accept"}
              </Button>
            </div>
            )}
          </div>
        )}

        {/* Floating "Jump to [the PM's project]" pill. Zero-height sticky wrapper
            so it hovers at the bottom of the scroll viewport without reserving
            trailing blank space. Kept mounted (opacity/translate toggled) so the
            fade-out animates when the target section scrolls into view. */}
        <div aria-hidden={!showJump} className="pointer-events-none sticky bottom-0 z-20 h-0">
          <div className="flex -translate-y-4 justify-center">
            <button
              type="button"
              onClick={() => targetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              tabIndex={showJump ? 0 : -1}
              className={cn(
                "pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg transition-[opacity,transform] duration-3 ease-out-quart",
                showJump ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
              )}
            >
              Jump to {targetProjectName}
              <ChevronDown key={String(showJump)} size={16} className={showJump ? "animate-nudge" : undefined} />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The applicant's optional "About you" answers + their uploaded resume (opened
// via a short-lived signed URL), above their rankings.
function ApplicantDetails({
  profile,
  onOpenResume,
  resumeOpening,
  flash,
}: {
  profile: Profile | null;
  onOpenResume: () => void;
  resumeOpening: boolean;
  flash: FocusSection | null;
}) {
  const ratedAreas = Object.entries(profile?.tech_area_rankings ?? {})
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => b[1] - a[1]);
  const classes = profile?.tech_classes ?? [];
  const other = profile?.tech_classes_other?.trim();
  const note = profile?.about_note?.trim();
  const portfolioUrl = profile?.portfolio_url?.trim();
  const hasResume = !!profile?.resume_path;
  const hasAny = ratedAreas.length > 0 || classes.length > 0 || !!other || !!note || hasResume || !!portfolioUrl;

  return (
    <div className="flex flex-col gap-3 rounded-xl surface p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applicant details</h3>

      {!hasAny ? (
        <p className="text-sm italic text-muted-foreground">No additional details provided.</p>
      ) : (
        <>
          {ratedAreas.length > 0 && (
            <div
              data-section="areas"
              className={cn(
                "flex flex-col gap-1 scroll-mt-2 rounded-lg transition-shadow",
                flash === "areas" && FLASH_RING,
              )}
            >
              <span className="text-xs font-medium text-muted-foreground">Technical areas of interest</span>
              {/* A row per area with a five-dot meter instead of pills. */}
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {ratedAreas.map(([key, v]) => (
                  <div key={key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <TechAreaIcon areaKey={key} size={14} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{techAreaLabel(key)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5" aria-label={`${v} of 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={cn("h-1.5 w-1.5 rounded-full", n <= Number(v) ? "bg-foreground" : "bg-foreground/15")} />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(classes.length > 0 || other) && (
            <div
              data-section="classes"
              className={cn(
                "flex flex-col gap-1 scroll-mt-2 rounded-lg transition-shadow",
                flash === "classes" && FLASH_RING,
              )}
            >
              <span className="text-xs font-medium text-muted-foreground">Tech classes</span>
              <p className="text-sm">
                {[...classes.map((c) => techClassLabel(c)), ...(other ? [other] : [])].join(", ")}
              </p>
            </div>
          )}

          {hasResume && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Resume</span>
              <button
                type="button"
                onClick={onOpenResume}
                disabled={resumeOpening}
                className="inline-flex items-center gap-1.5 self-start text-sm underline-offset-2 hover:underline disabled:opacity-50"
              >
                <FileText size={14} className="text-muted-foreground" />
                {resumeOpening ? "Opening…" : profile?.resume_filename || "View resume"}
              </button>
            </div>
          )}

          {portfolioUrl && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Portfolio</span>
              <a
                href={portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start text-sm text-brand hover:text-brand/80 underline underline-offset-2 break-all"
              >
                {portfolioUrl}
              </a>
            </div>
          )}

          {note && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Anything else</span>
              <p className="text-sm whitespace-pre-wrap text-foreground/90">{note}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The review while it loads: the details card with its real headings, a few
// ranked projects (header, essay lines, an answer block), and the real footer.
function ApplicationReviewSkeleton({ readOnly }: { readOnly?: boolean }) {
  const line = (w: string) => (
    <div className="flex h-5 items-center">
      <Skeleton className={`h-3.5 rounded-full ${w}`} />
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <div aria-hidden className="flex flex-col gap-3 rounded-xl surface p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applicant details</h3>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Technical areas of interest</span>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex h-5 items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                  <Skeleton className={`h-3.5 rounded-full ${["w-24", "w-32", "w-20", "w-28"][i]}`} />
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className="h-1.5 w-1.5 rounded-full bg-foreground/15" />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Tech classes</span>
          {line("w-3/4")}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Resume</span>
          {line("w-36")}
        </div>
      </div>

      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} aria-hidden className="flex flex-col gap-2">
          <div className="flex h-5 items-center gap-2">
            <span className="w-4 font-mono text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}.</span>
            <Skeleton className={`h-3.5 rounded-full ${["w-32", "w-40", "w-28"][i]}`} />
            <Skeleton className="h-3 w-12 rounded-full" />
          </div>
          {line("w-full")}
          {line("w-11/12")}
          {line("w-3/5")}
          <div className="flex flex-col gap-0.5 pl-2 border-l border-foreground/10">
            <div className="flex h-4 items-center pl-2">
              <Skeleton className="h-3 w-48 rounded-full" />
            </div>
            <div className="pl-2">{line("w-2/5")}</div>
          </div>
        </div>
      ))}

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <span className="mr-auto text-xs text-muted-foreground">Place on</span>
          <span className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background min-w-[10rem] text-muted-foreground">
            Select project…
            <ChevronDown size={14} />
          </span>
          <Button variant="outline" disabled>
            <X size={16} className="mr-1" />
            Reject
          </Button>
          <Button disabled>
            <Check size={16} className="mr-1" />
            Accept
          </Button>
        </div>
      )}
    </div>
  );
}
