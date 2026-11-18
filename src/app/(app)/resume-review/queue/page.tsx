"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { FileText, Check, ChevronDown } from "lucide-react";
import { PersonName, initials } from "@/components/person-profile-provider";
import { resumeSignedUrl } from "@/lib/resume-upload";
import { ReviewQueueCardsSkeleton } from "@/components/manager-skeletons";
import { optimistic } from "@/lib/optimistic";
import { BackLink } from "@/components/back-link";
import { InfoHint } from "@/components/ui/info-hint";
import { TabStrip } from "@/components/ui/tab-strip";
import { CountBadge } from "@/components/resume-review-badge";

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

function formatShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// `needed_by` is a bare DATE ("2026-10-03"). new Date() would read that as UTC
// midnight and render the day before anywhere west of Greenwich, so build the
// date in local time instead.
function formatDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ManagerResumeReviewsPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "reviewed">("queue");
  // Reviewed rows whose feedback is expanded.
  const [open, setOpen] = useState<Set<string>>(new Set());

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

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1 pt-4">
        <BackLink href="/resume-review" label="Resume review" />
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Resume Reviews</h1>
          <InfoHint label="About the queue" side="right">
            Sending feedback notifies the requester.
          </InfoHint>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4">
        <TabStrip
          aria-label="Resume reviews"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "queue", label: <>Queue<CountBadge inline count={items ? pending.length : null} /></> },
            { value: "reviewed", label: "Reviewed", count: items ? done.length : null },
          ]}
        />

        {items === null ? (
          <div className="flex flex-col gap-3">
            <ReviewQueueCardsSkeleton />
          </div>
        ) : tab === "queue" ? (
          pending.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Queue is clear.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((item) => (
                <div key={item.id} className="flex flex-col gap-2.5 rounded-xl surface p-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar url={item.requesterAvatarUrl} name={item.requesterName} size="h-8 w-8 text-[11px]" />
                    <div className="flex min-w-0 flex-col">
                      <PersonName
                        userId={item.requester_id}
                        name={item.requesterName}
                        preloaded={{ avatar_url: item.requesterAvatarUrl }}
                        className="truncate text-sm font-medium"
                      />
                      <span className="truncate text-xs text-muted-foreground">
                        {formatShort(item.created_at)}
                        {item.needed_by && <> · due {formatDateOnly(item.needed_by)}</>}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openResume(item.resume_path)}
                      className="ml-auto inline-flex min-w-0 max-w-[45%] items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-foreground/[0.1]"
                    >
                      <FileText size={14} className="shrink-0" />
                      <span className="truncate">{item.resume_filename ?? "Resume"}</span>
                    </button>
                  </div>

                  {item.target_roles && (
                    <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground" title={item.target_roles}>
                      {item.target_roles}
                    </p>
                  )}

                  <textarea
                    value={drafts[item.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                    rows={3}
                    placeholder="Your feedback…"
                    className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-foreground/30"
                  />

                  <button
                    type="button"
                    onClick={() => submitFeedback(item.id)}
                    disabled={!(drafts[item.id] ?? "").trim()}
                    className="self-end inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check size={14} />
                    Send
                  </button>
                </div>
              ))}
            </div>
          )
        ) : done.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No reviews yet.</p>
        ) : (
          <div className="flex flex-col divide-y rounded-xl surface">
            {done.map((item) => {
              const isOpen = open.has(item.id);
              return (
                <div key={item.id} className="flex flex-col">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(item.id)}
                    className="flex min-w-0 items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]"
                  >
                    <ChevronDown
                      size={14}
                      className={`shrink-0 text-muted-foreground transition-transform duration-instant ease-out-quart ${isOpen ? "" : "-rotate-90"}`}
                    />
                    <span className="truncate text-sm font-medium">{item.requesterName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatShort(item.completed_at ?? item.created_at)}
                    </span>
                    {/* The exec who answered. reviewer_id goes null if that
                        person's account is deleted. */}
                    {item.reviewer_id && item.reviewerName ? (
                      <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Avatar url={item.reviewerAvatarUrl} name={item.reviewerName} size="h-5 w-5 text-[9px]" />
                        <span className="hidden truncate sm:inline">{item.reviewerName}</span>
                      </span>
                    ) : (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">Former member</span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="grid animate-expand">
                      <div className="min-h-0 overflow-hidden">
                        <div className="flex flex-col gap-2 px-3 pb-3 pl-9">
                          {item.feedback && (
                            <p className="whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-sm">
                              {item.feedback}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => openResume(item.resume_path)}
                            className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <FileText size={14} />
                            {item.resume_filename ?? "Resume"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ url, name, size }: { url: string | null; name: string; size: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-foreground/10 font-semibold`}>
      {initials(name)}
    </span>
  );
}
