"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Check } from "lucide-react";
import { PersonName, initials } from "@/components/person-profile-provider";
import { resumeSignedUrl } from "@/lib/resume-upload";
import { Skeleton } from "@/components/ui/skeleton";

type QueueItem = {
  id: string;
  requester_id: string;
  requesterName: string;
  requesterAvatarUrl: string | null;
  resume_path: string;
  resume_filename: string | null;
  note: string | null;
  created_at: string;
  status: "pending" | "completed" | "cancelled";
  feedback: string | null;
  completed_at: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ManagerResumeReviewsPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: rows } = await supabase
      .from("resume_reviews")
      .select("id, requester_id, resume_path, resume_filename, note, created_at, status, feedback, completed_at")
      .order("created_at", { ascending: true });

    const requesterIds = [...new Set((rows ?? []).map((r) => r.requester_id))];
    const people = new Map<string, { name: string; avatarUrl: string | null }>();
    if (requesterIds.length) {
      const { data: members } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname, avatar_url")
        .in("user_id", requesterIds);
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
  const submitFeedback = async (id: string) => {
    const feedback = (drafts[id] ?? "").trim();
    if (!feedback) return;
    setSubmitting(id);
    setError(null);
    const { error: rpcError } = await createClient().rpc("complete_resume_review", {
      p_review_id: id,
      p_feedback: feedback,
    });
    setSubmitting(null);
    if (rpcError) {
      setError(rpcError.message || "Couldn't submit that feedback.");
      return;
    }
    setDrafts((d) => { const next = { ...d }; delete next[id]; return next; });
    load();
  };

  const pending = items?.filter((i) => i.status === "pending") ?? [];
  const done = items?.filter((i) => i.status === "completed").slice().reverse() ?? [];

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/manager"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft size={14} />
          Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Resume Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Read a requested resume and send written feedback. Submitting notifies the requester.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">
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
                <div key={item.id} className="flex flex-col gap-3 rounded-xl border p-4">
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

                  {item.note && (
                    <p className="rounded-lg border bg-foreground/[0.03] px-3 py-2 text-sm text-muted-foreground">
                      {item.note}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => openResume(item.resume_path)}
                    className="self-start inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium hover:border-foreground/20 transition-colors"
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
                    disabled={!(drafts[item.id] ?? "").trim() || submitting === item.id}
                    className="self-start inline-flex items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check size={16} />
                    {submitting === item.id ? "Sending…" : "Send feedback"}
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
                <div key={item.id} className="flex flex-col gap-2 rounded-xl border p-4 opacity-70">
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
                  </div>
                  {item.feedback && (
                    <p className="whitespace-pre-wrap rounded-lg border bg-foreground/[0.03] px-3 py-2 text-sm">
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
