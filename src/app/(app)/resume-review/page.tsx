"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Upload, Clock, Check, X, Inbox } from "lucide-react";
import { PersonName } from "@/components/person-profile-provider";
import { useRoleSim } from "@/components/role-simulation-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { uploadResume, resumeSignedUrl, MAX_RESUME_BYTES } from "@/lib/resume-upload";

type Review = {
  id: string;
  status: "pending" | "completed" | "cancelled";
  target_roles: string | null;
  needed_by: string | null;
  feedback: string | null;
  resume_path: string;
  resume_filename: string | null;
  reviewer_id: string | null;
  reviewerName: string | null;
  created_at: string;
  completed_at: string | null;
};

type Resume = { path: string; filename: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// `needed_by` is a bare DATE ("2026-10-03"). new Date() would read that as UTC
// midnight and render the day before anywhere west of Greenwich, so build the
// date in local time instead.
function formatDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ResumeReviewPage() {
  const { isExec } = useRoleSim();
  const [userId, setUserId] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [targetRoles, setTargetRoles] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Review | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [{ data: memberRow }, { data: rows }] = await Promise.all([
      supabase.from("members").select("resume_path, resume_filename").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("resume_reviews")
        .select("id, status, target_roles, needed_by, feedback, resume_path, resume_filename, reviewer_id, created_at, completed_at")
        .eq("requester_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

    setResume(
      memberRow?.resume_path
        ? { path: memberRow.resume_path as string, filename: (memberRow.resume_filename as string | null) ?? "Resume" }
        : null,
    );

    // Resolve reviewer names in one pass so completed feedback is attributable.
    const reviewerIds = [...new Set((rows ?? []).map((r) => r.reviewer_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (reviewerIds.length) {
      const { data: people } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname")
        .in("user_id", reviewerIds);
      for (const p of people ?? []) {
        names.set(p.user_id, `${p.preferred_firstname ?? ""} ${p.lastname ?? ""}`.trim());
      }
    }

    setReviews(
      (rows ?? []).map((r) => ({
        ...r,
        reviewerName: r.reviewer_id ? names.get(r.reviewer_id) ?? null : null,
      })) as Review[],
    );
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = reviews?.find((r) => r.status === "pending") ?? null;
  const history = reviews?.filter((r) => r.status !== "pending") ?? [];

  const onFileSelected = async (file: File) => {
    const supabase = createClient();
    if (!userId) return;
    setUploading(true);
    setError(null);
    try {
      const { path, filename } = await uploadResume(supabase, userId, file);
      await supabase
        .from("members")
        .update({ resume_path: path, resume_filename: filename, resume_uploaded_at: new Date().toISOString() })
        .eq("user_id", userId);
      setResume({ path, filename });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const openResume = async (path: string) => {
    const url = await resumeSignedUrl(createClient(), path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("Couldn't open that resume.");
  };

  const submit = async () => {
    if (!userId || !resume) return;
    setSubmitting(true);
    setError(null);
    // The resume path is snapshotted here on purpose: re-uploading later must
    // not silently re-point feedback that was written about this version.
    const { error: insertError } = await createClient().from("resume_reviews").insert({
      requester_id: userId,
      resume_path: resume.path,
      resume_filename: resume.filename,
      target_roles: targetRoles.trim() || null,
      needed_by: neededBy || null,
    });
    setSubmitting(false);
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "You already have a review request waiting."
          : "Couldn't submit that request.",
      );
      return;
    }
    setTargetRoles("");
    setNeededBy("");
    load();
  };

  const cancel = async () => {
    const target = cancelTarget;
    setCancelTarget(null);
    if (!target) return;
    const { error: cancelError } = await createClient()
      .from("resume_reviews")
      .update({ status: "cancelled" })
      .eq("id", target.id);
    if (cancelError) setError("Couldn't withdraw that request.");
    load();
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Resume Review</h1>
        <p className="text-sm text-muted-foreground">
          Ask a member of our team to look over your resume. You can request one any time —
          it&apos;s not part of the application.
        </p>
        {/* Exec staff the queue; the route itself is guarded server-side. */}
        {isExec && (
          <Link
            href="/resume-review/queue"
            className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-colors"
          >
            <Inbox size={14} />
            Review queue
          </Link>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {reviews === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : pending ? (
        <div className="flex flex-col gap-3 rounded-xl border border-foreground/15 bg-foreground/[0.03] p-4">
          <div className="flex items-center gap-2">
            <Clock size={16} className="shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold">Waiting for a reviewer</h2>
              <p className="text-xs text-muted-foreground">
                Requested {formatDate(pending.created_at)} · we&apos;ll notify you when feedback is ready.
              </p>
            </div>
          </div>
          {(pending.target_roles || pending.needed_by) && (
            <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2">
              {pending.target_roles && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Targeting
                  </span>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{pending.target_roles}</p>
                </div>
              )}
              {pending.needed_by && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Needed by
                  </span>
                  <p className="text-sm text-muted-foreground">{formatDateOnly(pending.needed_by)}</p>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openResume(pending.resume_path)}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium hover:border-foreground/20 transition-colors"
            >
              <FileText size={14} />
              {pending.resume_filename ?? "Resume"}
            </button>
            <button
              type="button"
              onClick={() => setCancelTarget(pending)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <X size={14} />
              Withdraw
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border p-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold">Request a review</h2>
            <p className="text-xs text-muted-foreground">
              We&apos;ll review the resume you have on file.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {resume ? (
              <button
                type="button"
                onClick={() => openResume(resume.path)}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium hover:border-foreground/20 transition-colors"
              >
                <FileText size={14} />
                {resume.filename}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">No resume on file yet.</span>
            )}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Upload size={14} />
              {uploading ? "Uploading…" : resume ? "Replace" : "Upload resume"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onFileSelected(file);
              }}
            />
            <span className="text-[11px] text-muted-foreground">
              PDF or Word, max {Math.round(MAX_RESUME_BYTES / 1024)} KB.
            </span>
          </div>

          {/* Both optional — a request with neither answered is still valid. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="target-roles" className="text-sm font-medium">
              Any specific companies/roles you are targeting with this resume?{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <p className="text-xs text-muted-foreground">
              You can put the link to the job description, role title, company name, or anything
              else that is relevant. If not, put N/A.
            </p>
            <textarea
              id="target-roles"
              value={targetRoles}
              onChange={(e) => setTargetRoles(e.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="needed-by" className="text-sm font-medium">
              When do you need feedback by?{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="needed-by"
              type="date"
              value={neededBy}
              onChange={(e) => setNeededBy(e.target.value)}
              className="w-fit rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground/30"
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!resume || submitting}
            className="self-start inline-flex items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Requesting…" : "Request review"}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Past Reviews
          </h2>
          {history.map((r) => (
            <div key={r.id} className={`flex flex-col gap-2 rounded-xl border p-4 ${r.status === "cancelled" ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full flex-shrink-0 ${
                    r.status === "completed"
                      ? "bg-green-600/10 text-green-700 dark:text-green-400"
                      : "bg-foreground/5 text-foreground/70"
                  }`}
                >
                  {r.status === "completed" ? <Check size={14} /> : <X size={14} />}
                </span>
                <span className="text-sm font-medium">
                  {r.status === "completed" ? "Feedback received" : "Withdrawn"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(r.completed_at ?? r.created_at)}
                  {r.reviewerName && r.reviewer_id && <> · </>}
                </span>
                {r.reviewerName && r.reviewer_id && (
                  <PersonName userId={r.reviewer_id} name={r.reviewerName} className="text-xs text-muted-foreground" />
                )}
              </div>
              {r.feedback && (
                <p className="whitespace-pre-wrap rounded-lg border bg-foreground/[0.03] px-3 py-2 text-sm">
                  {r.feedback}
                </p>
              )}
              <button
                type="button"
                onClick={() => openResume(r.resume_path)}
                className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <FileText size={14} />
                {r.resume_filename ?? "Resume"} (as reviewed)
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title="Withdraw this request?"
        description="Your request will be removed from the review queue. You can request another one any time."
        confirmLabel="Withdraw"
        destructive
        onConfirm={cancel}
      />
    </div>
  );
}
