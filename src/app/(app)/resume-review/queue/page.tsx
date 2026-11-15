"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { FileText, Check } from "lucide-react";
import { PersonName, initials } from "@/components/person-profile-provider";
import { resumeSignedUrl } from "@/lib/resume-upload";
import { Skeleton } from "@/components/ui/skeleton";
import { optimistic } from "@/lib/optimistic";
import { BackLink } from "@/components/back-link";

type QueueItem = {
  id: string;
  requester_id: string;
  requesterName: string;
  requesterAvatarUrl: string | null;
  resume_path: string;
  resume_filename: string | null;
  target_roles: string | null;
  needed_by: string | null;
  created_at: string;
  status: "pending" | "completed" | "cancelled";
  feedback: string | null;
  completed_at: string | null;
  reviewer_id: string | null;
  reviewerName: string | null;
  reviewerAvatarUrl: string | null;
};

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

export default function ManagerResumeReviewsPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: rows } = await supabase
      .from("resume_reviews")
      .select("id, requester_id, resume_path, resume_filename, target_roles, needed_by, created_at, status, feedback, completed_at, reviewer_id")
      .order("created_at", { ascending: true });

    // One lookup covers both sides: the requester on every card, and the exec
    // who answered on completed ones.
    const personIds = [
      ...new Set((rows ?? []).flatMap((r) => [r.requester_id, r.reviewer_id]).filter(Boolean)),
    ] as string[];
    const people = new Map<string, { name: string; avatarUrl: string | null }>();
    if (personIds.length) {
      const { data: members } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname, avatar_url")
        .in("user_id", personIds);
      for (const m of members ?? []) {
        people.set(m.user_id, {
          name: `${m.preferred_firstname ?? ""} ${m.lastname ?? ""}`.trim() || "Unknown",
          avatarUrl: m.avatar_url ?? null,
        });
      }
    }

    setItems(
      (rows ?? []).map((r) => ({
        ...r,
        requesterName: people.get(r.requester_id)?.name ?? "Unknown",
        requesterAvatarUrl: people.get(r.requester_id)?.avatarUrl ?? null,
        reviewerName: r.reviewer_id ? people.get(r.reviewer_id)?.name ?? "Unknown" : null,
        reviewerAvatarUrl: r.reviewer_id ? people.get(r.reviewer_id)?.avatarUrl ?? null : null,
      })) as QueueItem[],
    );
  }, []);

  useEffect(() => { load(); }, [load]);

  const openResume = async (path: string) => {
    const url = await resumeSignedUrl(createClient(), path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("Couldn't open that resume.");
  };

  // Feedback goes through the RPC, never a direct UPDATE: it's what notifies
  // the requester, and RLS grants reviewers no write path of their own.
  // The item moves to "done" immediately; if the RPC refuses, it moves back
  // with the draft text restored so nothing typed is lost.
  const submitFeedback = (id: string) => {
    const draft = drafts[id] ?? "";
    const feedback = draft.trim();
    if (!feedback) return;
    setError(null);
    const before = items?.find((i) => i.id === id);
    const patch = (p: Partial<QueueItem>) =>
      setItems((prev) => (prev ? prev.map((i) => (i.id === id ? { ...i, ...p } : i)) : prev));
    void optimistic({
      label: "feedback",
      key: `resume-feedback:${id}`,
      apply: () => {
        patch({ status: "completed", feedback, completed_at: new Date().toISOString() });
        setDrafts((d) => { const next = { ...d }; delete next[id]; return next; });
      },
      rollback: () => {
        if (before) patch({ status: before.status, feedback: before.feedback, completed_at: before.completed_at });
        setDrafts((d) => ({ ...d, [id]: draft }));
      },
      commit: () => createClient().rpc("complete_resume_review", { p_review_id: id, p_feedback: feedback }),
      onCommitted: () => void load(),
    });
  };

  const pending = items?.filter((i) => i.status === "pending") ?? [];
  const done = items?.filter((i) => i.status === "completed").slice().reverse() ?? [];

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <BackLink href="/resume-review" label="Resume review" />
        <h1 className="text-2xl font-bold tracking-tight">Resume Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Read a requested resume and send written feedback. Submitting notifies the requester.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {items === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Waiting ({pending.length})
            </h2>
            {pending.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing in the queue right now.
              </p>
            ) : (
              pending.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-xl surface p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {item.requesterAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.requesterAvatarUrl}
                        alt={item.requesterName}
                        className="h-10 w-10 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold flex-shrink-0">
                        {initials(item.requesterName)}
                      </span>
                    )}
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <PersonName
                        userId={item.requester_id}
                        name={item.requesterName}
                        preloaded={{ avatar_url: item.requesterAvatarUrl }}
                        className="text-sm font-medium"
                      />
                      <span className="text-xs text-muted-foreground">
                        Requested {formatDate(item.created_at)}
                      </span>
                    </div>
                  </div>

                  {(item.target_roles || item.needed_by) && (
                    <div className="flex flex-col gap-2 rounded-lg bg-background px-3 py-2">
                      {item.target_roles && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Targeting
                          </span>
                          <p className="whitespace-pre-wrap text-sm">{item.target_roles}</p>
                        </div>
                      )}
                      {item.needed_by && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Needed by
                          </span>
                          <p className="text-sm">{formatDateOnly(item.needed_by)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => openResume(item.resume_path)}
                    className="self-start inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-foreground/[0.1]"
                  >
                    <FileText size={14} />
                    {item.resume_filename ?? "Resume"}
                  </button>

                  <textarea
                    value={drafts[item.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                    rows={5}
                    placeholder="Your feedback…"
                    className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground/30"
                  />

                  <button
                    type="button"
                    onClick={() => submitFeedback(item.id)}
                    disabled={!(drafts[item.id] ?? "").trim()}
                    className="self-start inline-flex items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check size={16} />
                    Send feedback
                  </button>
                </div>
              ))
            )}
          </div>

          {done.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Completed
              </h2>
              {done.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 rounded-xl surface p-4 opacity-70">
                  <div className="flex flex-wrap items-center gap-2">
                    <PersonName
                      userId={item.requester_id}
                      name={item.requesterName}
                      preloaded={{ avatar_url: item.requesterAvatarUrl }}
                      className="text-sm font-medium"
                    />
                    <span className="text-xs text-muted-foreground">
                      · reviewed {formatDate(item.completed_at ?? item.created_at)}
                    </span>
                    {/* The exec who answered, not the requester. reviewer_id goes
                        null if that person's account is deleted. */}
                    {item.reviewer_id && item.reviewerName ? (
                      <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-background py-0.5 pl-0.5 pr-2.5 text-xs">
                        {item.reviewerAvatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.reviewerAvatarUrl}
                            alt=""
                            className="h-5 w-5 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-semibold">
                            {initials(item.reviewerName)}
                          </span>
                        )}
                        <span className="text-muted-foreground">Reviewed by</span>
                        <PersonName
                          userId={item.reviewer_id}
                          name={item.reviewerName}
                          preloaded={{ avatar_url: item.reviewerAvatarUrl }}
                          className="font-medium"
                        />
                      </span>
                    ) : (
                      <span className="ml-auto inline-flex items-center rounded-full bg-foreground/[0.05] px-2.5 py-0.5 text-xs text-muted-foreground">
                        Reviewer no longer a member
                      </span>
                    )}
                  </div>
                  {item.feedback && (
                    <p className="whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-sm">
                      {item.feedback}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
