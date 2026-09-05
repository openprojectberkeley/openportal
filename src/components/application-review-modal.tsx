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
import { Badge } from "@/components/ui/badge";
import { ProjectApplicationModalSkeleton } from "@/components/skeletons";
import { resumeSignedUrl } from "@/lib/resume-upload";
import { techAreaLabel, techClassLabel } from "@/lib/application-profile";

export type ReviewStatus = "submitted" | "accepted" | "rejected";

// Temporarily disables Accept and Reject so nobody decides an applicant's
// outcome early while project assignments are still being finalized.
// Reviewing (reading the application) stays available. Flip back to true
// once decisions should reopen.
const DECISIONS_ENABLED = false;

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
  open,
  onOpenChange,
  onReviewed,
}: {
  applicationId: string;
  applicantName: string;
  status: ReviewStatus;
  // The project the reviewer is currently reviewing under (the manager page's
  // project picker). Rankings for projects the reviewer can't review are
  // already excluded by RLS, but when there's more than one visible ranking
  // this decides which one the "Place on" dropdown defaults to.
  contextProjectId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReviewed: (status: ReviewStatus) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [answersByRanking, setAnswersByRanking] = useState<Record<string, AnswerRow[]>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resumeOpening, setResumeOpening] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default true = hidden, so the "Jump to" pill never flashes when the PM's
  // project is already on screen; the observer reveals it a frame later if the
  // section is actually scrolled out of view.
  const [targetInView, setTargetInView] = useState(true);

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
        .select("applicant_id, tech_area_rankings, tech_classes, tech_classes_other, about_note, portfolio_url")
        .eq("id", applicationId)
        .maybeSingle();
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

  const accept = async () => {
    if (!selectedProjectId) { setError("Pick a project to place them on."); return; }
    setWorking(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("accept_application", {
      p_application_id: applicationId,
      p_project_id: selectedProjectId,
    });
    setWorking(false);
    if (err) { setError(err.message); return; }
    onReviewed("accepted");
    onOpenChange(false);
  };

  const reject = async () => {
    if (!window.confirm(`Reject ${applicantName}'s application?`)) return;
    setWorking(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc("reject_application", { p_application_id: applicationId });
    setWorking(false);
    if (err) { setError(err.message); return; }
    onReviewed("rejected");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {applicantName}
            {status === "accepted" && <Badge className="bg-green-600 hover:bg-green-600">Accepted</Badge>}
            {status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <ProjectApplicationModalSkeleton />
        ) : (
          <div className="flex flex-col gap-6">
            <ApplicantDetails profile={profile} onOpenResume={openResume} resumeOpening={resumeOpening} />

            {rankings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ranked projects on this application.</p>
            ) : (
              rankings.map((r) => (
                <div
                  key={r.id}
                  ref={r.project?.id === contextProjectId ? targetRef : undefined}
                  className="flex flex-col gap-2 scroll-mt-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold tabular-nums">
                      {r.rank}
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
                      <div key={i} className="flex flex-col gap-0.5 pl-1 border-l-2 border-muted">
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

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
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
                "pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg transition-all duration-300",
                showJump ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
              )}
            >
              Jump to {targetProjectName}
              <ChevronDown size={16} className="animate-bounce" />
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
}: {
  profile: Profile | null;
  onOpenResume: () => void;
  resumeOpening: boolean;
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
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applicant details</h3>

      {!hasAny ? (
        <p className="text-sm italic text-muted-foreground">No additional details provided.</p>
      ) : (
        <>
          {ratedAreas.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Technical areas of interest</span>
              <div className="flex flex-wrap gap-1.5">
                {ratedAreas.map(([key, v]) => (
                  <span key={key} className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs">
                    {techAreaLabel(key)} <span className="tabular-nums text-muted-foreground">{v}/5</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(classes.length > 0 || other) && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Tech classes</span>
              <div className="flex flex-wrap gap-1.5">
                {classes.map((c) => (
                  <span key={c} className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs">{techClassLabel(c)}</span>
                ))}
              </div>
              {other && <p className="text-sm text-foreground/90">Other: {other}</p>}
            </div>
          )}

          {hasResume && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Resume</span>
              <button
                type="button"
                onClick={onOpenResume}
                disabled={resumeOpening}
                className="inline-flex items-center gap-1.5 self-start rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-50"
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
                className="self-start text-sm text-primary underline underline-offset-2 break-all"
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
