"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PersonName, initials } from "@/components/person-profile-provider";
import { resumeReviewFile, type ResumeFile } from "@/lib/resume-upload";
import { ResumeDownloadButton, ResumeFileActions } from "@/components/resume-review/resume-file-actions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResumeReviewModal } from "@/components/resume-review/resume-review-modal";
import type { ResumeReviewContext } from "@/components/resume-review/resume-review-workspace";
import { ReviewQueueCardsSkeleton } from "@/components/manager-skeletons";
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
  file_path: string | null;
  noteCount: number;
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
  const [tab, setTab] = useState<"queue" | "reviewed">("queue");
  // Reviewed rows whose feedback is expanded.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<{ file: ResumeFile; review?: ResumeReviewContext } | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: rows } = await supabase
      .from("resume_reviews")
      .select("id, requester_id, resume_path, resume_filename, file_path, target_roles, needed_by, created_at, status, feedback, completed_at, reviewer_id, resume_review_notes(count)")
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
        noteCount: (r.resume_review_notes as unknown as { count: number }[])[0]?.count ?? 0,
        requesterName: people.get(r.requester_id)?.name ?? "Unknown",
        requesterAvatarUrl: people.get(r.requester_id)?.avatarUrl ?? null,
        reviewerName: r.reviewer_id ? people.get(r.reviewer_id)?.name ?? "Unknown" : null,
        reviewerAvatarUrl: r.reviewer_id ? people.get(r.reviewer_id)?.avatarUrl ?? null : null,
      })) as QueueItem[],
    );
  }, []);

  useEffect(() => { load(); }, [load]);

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
              {pending.map((item) => {
                const file = resumeReviewFile(item);
                return (
                  <div key={item.id} className="flex items-center gap-2.5 rounded-xl surface p-3 min-w-0">
                    <Avatar url={item.requesterAvatarUrl} name={item.requesterName} size="h-8 w-8 text-[11px]" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <PersonName
                        userId={item.requester_id}
                        name={item.requesterName}
                        preloaded={{ avatar_url: item.requesterAvatarUrl }}
                        className="truncate text-sm font-medium"
                      />
                      <span className="truncate text-xs text-muted-foreground">
                        {formatShort(item.created_at)}
                        {item.needed_by && <> · due {formatDateOnly(item.needed_by)}</>}
                        {item.noteCount > 0 && <> · {item.noteCount} {item.noteCount === 1 ? "note" : "notes"}</>}
                      </span>
                      {item.target_roles && (
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground" title={item.target_roles}>
                          {item.target_roles}
                        </p>
                      )}
                    </div>
                    <ResumeDownloadButton file={file} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setViewing({ file, review: reviewContext(item) })}
                          className="h-8 shrink-0 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
                        >
                          Review
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{file.filename}</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
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
                          <ResumeFileActions
                            file={resumeReviewFile(item)}
                            onOpen={() => setViewing({ file: resumeReviewFile(item), review: reviewContext(item) })}
                          />
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

      <ResumeReviewModal
        file={viewing?.file ?? null}
        review={viewing?.review}
        onOpenChange={(o) => { if (!o) setViewing(null); }}
        onChanged={() => void load()}
      />
    </div>
  );
}

function reviewContext(item: QueueItem): ResumeReviewContext {
  return {
    id: item.id,
    status: item.status,
    requesterName: item.requesterName,
    targetRoles: item.target_roles,
    neededBy: item.needed_by ? formatDateOnly(item.needed_by) : null,
    feedback: item.feedback,
    reviewerName: item.reviewerName,
  };
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
