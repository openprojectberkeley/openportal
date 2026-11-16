"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabStrip } from "@/components/ui/tab-strip";
import { InfoHint } from "@/components/ui/info-hint";
import {
  ApplicantsTab,
  ApplicantsSkeleton,
  OverviewSkeleton,
  RetentionSkeleton,
  OverviewTab,
  RetentionTab,
} from "@/components/application-analytics-modal";
import { ProjectsSkeleton, ProjectsTab } from "@/components/project-analytics-modal";
import { useRecruitingAnalytics } from "@/lib/use-recruiting-analytics";

export type AnalyticsPeriod = { id: string; name: string };

type Tab = "overview" | "applicants" | "retention" | "projects";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "applicants", label: "Applicants" },
  { value: "retention", label: "Retention" },
  { value: "projects", label: "Projects" },
];

// Exec recruiting analytics for one application period. The period picker and
// the single fetch (useRecruitingAnalytics) live here, so switching tabs never
// refetches or changes what you're looking at. Radix unmounts DialogContent on
// close, so the hook refetches on every open.
export function AnalyticsModal({
  open,
  onOpenChange,
  periods,
  initialPeriodId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periods: AnalyticsPeriod[];
  initialPeriodId: string | null;
}) {
  const [periodId, setPeriodId] = useState<string | null>(initialPeriodId);

  // Re-seed from the page's selected period on each open, so the modal always
  // opens on whatever the manager was already looking at.
  useEffect(() => {
    if (open) setPeriodId(initialPeriodId);
  }, [open, initialPeriodId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Analytics</DialogTitle>
        </DialogHeader>
        {open && <AnalyticsBody periods={periods} periodId={periodId} onPeriodChange={setPeriodId} />}
      </DialogContent>
    </Dialog>
  );
}

function AnalyticsBody({
  periods,
  periodId,
  onPeriodChange,
}: {
  periods: AnalyticsPeriod[];
  periodId: string | null;
  onPeriodChange: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const { data, loading, error } = useRecruitingAnalytics(periodId);
  const periodName = periods.find((p) => p.id === periodId)?.name ?? "Select period";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-[12rem] items-center justify-between gap-2 rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-foreground/[0.04]">
              <span className="font-medium">{periodName}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {periods.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => onPeriodChange(p.id)}>
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <InfoHint side="right">
          Requirement checks use each person&apos;s member status today, not when they applied. Returning means
          accepted in an earlier period, or a member today with no later acceptance. Exec-added draft entries
          aren&apos;t counted as applicants.
        </InfoHint>
      </div>

      <TabStrip
        aria-label="Analytics view"
        idPrefix="analytics-tab"
        panelId={(v) => `analytics-panel-${v}`}
        value={tab}
        onChange={setTab}
        tabs={TABS}
      />

      <div id={`analytics-panel-${tab}`} role="tabpanel" aria-labelledby={`analytics-tab-${tab}`} className="min-w-0">
        {!periodId ? (
          <p className="text-sm text-muted-foreground">No application periods yet.</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : loading || !data ? (
          <TabSkeleton tab={tab} />
        ) : tab === "overview" ? (
          <OverviewTab data={data} />
        ) : tab === "applicants" ? (
          <ApplicantsTab data={data} />
        ) : tab === "retention" ? (
          <RetentionTab data={data} periodId={periodId} onPeriodChange={onPeriodChange} />
        ) : (
          <ProjectsTab data={data} />
        )}
      </div>
    </div>
  );
}

function TabSkeleton({ tab }: { tab: Tab }) {
  if (tab === "projects") return <ProjectsSkeleton />;
  if (tab === "applicants") return <ApplicantsSkeleton />;
  if (tab === "retention") return <RetentionSkeleton />;
  return <OverviewSkeleton />;
}
