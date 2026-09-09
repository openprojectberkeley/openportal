"use client";

// The cross-project board behind ?project=all on the applications manager: one
// column per project, scrolled horizontally, showing who's already on the team
// and who the draft has confirmed / staged for it. Read-only -- clicking a card
// opens review, and nothing here stages, un-stages or reorders a pick. That
// stays with the project's own PM view and the exec draft manager.

import Link from "next/link";
import { Table2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { PersonName } from "@/components/person-profile-provider";
import { ProjectIcon } from "@/components/project-icon";
import { StaticApplicantCard, type AppRow } from "@/components/applicant-meta";
import { ApplicationListSkeleton } from "@/components/skeletons";
import { DEFAULT_ACCENT, accentStyle, readableTextColor } from "@/lib/portal-color";
import { useAllProjectsBoard, type BoardColumn, type BoardProject } from "@/lib/use-all-projects-board";

// A column's heading, matching the uppercase section headings the
// single-project view uses for Wishlist / Confirmed / Draft window.
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label} ({count})
    </h3>
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-4 text-center text-xs text-muted-foreground">{children}</div>
  );
}

// ProjectIcon renders nothing for a project with neither an emoji nor an
// uploaded image; the columns want a placeholder either way so every head card
// lines up, so fall back to the project's initial on its accent.
function ColumnIcon({ project, accent }: { project: BoardProject; accent: string }) {
  if (project.icon || project.icon_url) return <ProjectIcon project={project} className="h-9 w-9" />;
  return (
    <span
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
      style={{ backgroundColor: accent, color: readableTextColor(accent) }}
      aria-hidden
    >
      {project.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function ProjectColumn({
  column,
  periodEndsAt,
  showRecruitingStatus,
  onReview,
}: {
  column: BoardColumn;
  periodEndsAt: string | undefined;
  showRecruitingStatus: boolean;
  onReview: (app: AppRow, projectId: string) => void;
}) {
  const { project, roster, confirmed, staged } = column;
  const accent = project.color || DEFAULT_ACCENT;
  const confirmedCount = confirmed.reduce((n, r) => n + r.apps.length, 0);
  const review = (app: AppRow) => onReview(app, project.id);

  return (
    <div className="flex w-[300px] shrink-0 flex-col gap-4">
      {/* Head card: the project's identity, painted with its own accent. */}
      <div className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5" style={accentStyle(accent)}>
        <ColumnIcon project={project} accent={accent} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold" title={project.name}>{project.name}</span>
          <span className="text-xs text-muted-foreground">
            {roster.length} on team · {confirmedCount} confirmed · {staged.length} staged
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeading label="On the team" count={roster.length} />
        {roster.length === 0 ? (
          <EmptySection>No one on this project yet.</EmptySection>
        ) : (
          roster.map((m) => (
            <div key={m.user_id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <PersonName userId={m.user_id} name={m.name} className="min-w-0 flex-1 truncate text-sm font-medium" />
              {m.isPm && <Badge variant="outline">PM</Badge>}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeading label="Confirmed" count={confirmedCount} />
        {confirmedCount === 0 ? (
          <EmptySection>No picks confirmed yet.</EmptySection>
        ) : (
          confirmed.map((round) => (
            <div key={round.roundNumber} className="flex flex-col gap-2">
              <span className="text-[11px] font-medium text-muted-foreground/80">Round {round.roundNumber}</span>
              {round.apps.map((app) => (
                <StaticApplicantCard
                  key={app.id}
                  app={app}
                  accent={accent}
                  periodEndsAt={periodEndsAt}
                  showRank
                  showRecruitingStatus={showRecruitingStatus}
                  onReview={review}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeading label="Staged" count={staged.length} />
        {/* Dashed and white, echoing the PM-side draft window these picks are
            sitting in -- they aren't locked in until that round is submitted. */}
        <div className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-foreground/25 bg-card p-2.5">
          {staged.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">Nothing staged.</p>
          ) : (
            staged.map((app) => (
              <StaticApplicantCard
                key={app.id}
                app={app}
                staged
                periodEndsAt={periodEndsAt}
                showRank
                showRecruitingStatus={showRecruitingStatus}
                onReview={review}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function AllProjectsBoard({
  periodId,
  periodEndsAt,
  counts,
  canDraft,
  showRecruitingStatus,
  onShowRecruitingStatusChange,
  onOpenSheet,
  onReview,
  reloadToken,
}: {
  periodId: string | null;
  periodEndsAt: string | undefined;
  // Period headline numbers, already loaded by the page.
  counts: { applicants: number; projects: number } | null;
  // Full-access reviewer: the draft manager is theirs to open.
  canDraft: boolean;
  showRecruitingStatus: boolean;
  onShowRecruitingStatusChange: (next: boolean) => void;
  onOpenSheet: () => void;
  // Carries the column's project so review opens with the right context project.
  onReview: (app: AppRow, projectId: string) => void;
  // Bumped by the page when a review changes something the board shows.
  reloadToken: number;
}) {
  const { columns, error } = useAllProjectsBoard(periodId, true, reloadToken);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every project</h2>
            <div className="flex items-center gap-1.5">
              <Switch
                id="board-show-recruiting-status"
                checked={showRecruitingStatus}
                onCheckedChange={onShowRecruitingStatusChange}
              />
              <Label
                htmlFor="board-show-recruiting-status"
                className="cursor-pointer text-[11px] font-medium text-muted-foreground"
              >
                Coffee & info
              </Label>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {counts
              ? `${counts.applicants} application${counts.applicants === 1 ? "" : "s"} across ${counts.projects} project${counts.projects === 1 ? "" : "s"}.`
              : "Loading counts…"}{" "}
            Scroll sideways for the rest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onOpenSheet} disabled={!periodId}>
            <Table2 size={14} className="mr-1.5" />
            Open sheet view
          </Button>
          {canDraft && (
            <Button asChild variant="outline" size="sm">
              <Link href="/manager/draft">
                <UserPlus size={14} className="mr-1.5" />
                Draft members
              </Link>
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {columns === null ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex w-[300px] shrink-0 flex-col gap-4">
              <div className="h-[62px] rounded-xl border bg-muted/30 animate-pulse" />
              <ApplicationListSkeleton rows={3} />
            </div>
          ))}
        </div>
      ) : columns.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
          No projects to review this period.
        </div>
      ) : (
        // Bottom padding leaves room for the overlay scrollbar under the columns.
        <ScrollArea orientation="horizontal" viewportClassName="pb-3">
          <div className="flex items-start gap-4">
            {columns.map((column) => (
              <ProjectColumn
                key={column.project.id}
                column={column}
                periodEndsAt={periodEndsAt}
                showRecruitingStatus={showRecruitingStatus}
                onReview={onReview}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
