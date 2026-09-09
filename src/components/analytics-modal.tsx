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
import { RecruitingAnalyticsBody } from "@/components/application-analytics-modal";
import { ProjectAnalyticsBody } from "@/components/project-analytics-modal";

export type AnalyticsPeriod = { id: string; name: string };

type Tab = "recruiting" | "projects";
const TABS: { key: Tab; label: string }[] = [
  { key: "recruiting", label: "Recruiting" },
  { key: "projects", label: "Projects" },
];

// Exec analytics for one application period, in two tabs: the recruiting funnel
// (coffee/info validity, demographics, history) and the project × rank demand
// matrix. The period picker lives here rather than in either body, so switching
// tabs never switches what you're looking at.
//
// Only the active tab's body is mounted, and Radix unmounts DialogContent on
// close -- so each body fetches on mount instead of guarding on `open`.
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
  const [tab, setTab] = useState<Tab>("recruiting");
  const [periodId, setPeriodId] = useState<string | null>(initialPeriodId);

  // Re-seed from the page's selected period on each open, so the modal always
  // opens on whatever the manager was already looking at.
  useEffect(() => {
    if (open) setPeriodId(initialPeriodId);
  }, [open, initialPeriodId]);

  const periodName = periods.find((p) => p.id === periodId)?.name ?? "Select period";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Analytics</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-between gap-2 self-start rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent transition-colors min-w-[12rem]">
                <span className="font-medium">{periodName}</span>
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {periods.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setPeriodId(p.id)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex gap-1 border-b">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "recruiting" ? (
            <RecruitingAnalyticsBody periodId={periodId} onPeriodChange={setPeriodId} />
          ) : (
            <ProjectAnalyticsBody periodId={periodId} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
