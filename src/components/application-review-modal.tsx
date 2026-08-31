"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
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
import { techAreaLabel, techClassLabel } from "@/lib/application-profile";

export type ReviewStatus = "submitted" | "accepted" | "rejected";

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

// The applicant's optional "About you" answers + their Google Drive resume link.
type Profile = {
  tech_area_rankings: Record<string, number> | null;
  tech_classes: string[] | null;
  tech_classes_other: string | null;
  about_note: string | null;
  resume_drive_url: string | null;
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
  open,
  onOpenChange,
  onReviewed,
}: {
  applicationId: string;
  applicantName: string;
  status: ReviewStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReviewed: (status: ReviewStatus) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [answersByRanking, setAnswersByRanking] = useState<Record<string, AnswerRow[]>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const load = async () => {
      const { data: appRow } = await supabase
        .from("applications")
        .select("tech_area_rankings, tech_classes, tech_classes_other, about_note, resume_drive_url, resume_filename")
        .eq("id", applicationId)
        .maybeSingle();
      setProfile((appRow as Profile | null) ?? null);

      const { data: rankRows } = await supabase
        .from("application_rankings")
        .select("id, rank, essay, project:projects(id, name, type)")
        .eq("application_id", applicationId)
        .eq("ranked", true)
        .order("rank");

      const rows = (rankRows ?? []) as unknown as RankingRow[];
      setRankings(rows);
      setSelectedProjectId(rows[0]?.project?.id ?? null);

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
  }, [open, applicationId]);

  const selectedProject = rankings.find((r) => r.project?.id === selectedProjectId)?.project ?? null;

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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
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
            <ApplicantDetails profile={profile} />

            {rankings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ranked projects on this application.</p>
            ) : (
              rankings.map((r) => (
                <div key={r.id} className="flex flex-col gap-2">
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
                        <span className="text-xs font-medium text-muted-foreground pl-2">
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
              <Button variant="outline" onClick={reject} disabled={working}>
                <X size={16} className="mr-1" />
                Reject
              </Button>
              <Button onClick={accept} disabled={working || !selectedProjectId}>
                <Check size={16} className="mr-1" />
                {working ? "Working…" : "Accept"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The applicant's optional "About you" answers + Drive resume link, above their
// rankings.
function ApplicantDetails({ profile }: { profile: Profile | null }) {
  const ratedAreas = Object.entries(profile?.tech_area_rankings ?? {})
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => b[1] - a[1]);
  const classes = profile?.tech_classes ?? [];
  const other = profile?.tech_classes_other?.trim();
  const note = profile?.about_note?.trim();
  const resumeUrl = profile?.resume_drive_url;
  const hasAny = ratedAreas.length > 0 || classes.length > 0 || !!other || !!note || !!resumeUrl;

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

          {resumeUrl && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Resume</span>
              <a
                href={resumeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 self-start rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent transition-colors"
              >
                <FileText size={14} className="text-muted-foreground" />
                {profile?.resume_filename || "View resume"}
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
