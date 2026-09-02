"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";
import { PersonName } from "@/components/person-profile-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApplicationListSkeleton } from "@/components/skeletons";
import { ApplicationPeriodsDialog, type ApplicationPeriod } from "@/components/application-periods-dialog";
import { ApplicationReviewModal, type ReviewStatus } from "@/components/application-review-modal";
import { ApplicationStats, type Stats } from "@/components/application-stats";

type Applicant = { user_id: string; preferred_firstname: string | null; lastname: string | null };

type AppRow = {
  id: string;
  status: ReviewStatus;
  submitted_at: string | null;
  applicant: Applicant | null;
  application_rankings: { rank: number; ranked: boolean; project: { name: string } | null }[];
};

function isOpenNow(p: ApplicationPeriod): boolean {
  const now = Date.now();
  return p.status === "open" && new Date(p.starts_at).getTime() <= now && now < new Date(p.ends_at).getTime();
}

function pickDefault(list: ApplicationPeriod[]): string | null {
  return list.find(isOpenNow)?.id ?? list[0]?.id ?? null;
}

function applicantName(a: AppRow): string {
  return [a.applicant?.preferred_firstname, a.applicant?.lastname].filter(Boolean).join(" ") || "Applicant";
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "accepted") return <Badge className="bg-green-600 hover:bg-green-600">Accepted</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="secondary">Submitted</Badge>;
}

function PeriodStatusText({ period }: { period: ApplicationPeriod }) {
  const label = isOpenNow(period)
    ? "Open now"
    : period.status === "open"
      ? "Open (outside window)"
      : period.status === "closed"
        ? "Closed"
        : "Draft";
  const color = isOpenNow(period) ? "text-green-600" : "text-muted-foreground";
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

export default function ManagerApplicationsPage() {
  const { isExec } = useRoleSim();

  const [periods, setPeriods] = useState<ApplicationPeriod[] | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [periodsDialogOpen, setPeriodsDialogOpen] = useState(false);
  const [reviewFor, setReviewFor] = useState<{ id: string; name: string; status: ReviewStatus } | null>(null);

  // Exec-only period funnel stats, shown above the list.
  const loadStats = useCallback(async (periodId: string) => {
    const supabase = createClient();
    const { data } = await supabase.rpc("application_period_stats", { p_period_id: periodId });
    setStats((data?.[0] as Stats) ?? null);
  }, []);

  const loadPeriods = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("application_periods")
      .select("id, name, starts_at, ends_at, status")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as ApplicationPeriod[];
    setPeriods(list);
    setSelectedPeriodId((cur) => (cur && list.some((p) => p.id === cur) ? cur : pickDefault(list)));
  }, []);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  useEffect(() => {
    if (!selectedPeriodId) { setApps([]); setStats(null); return; }
    const supabase = createClient();
    setApps(null);
    // applicant_id is the auth user id (no FK to `members`), so fetch the rows
    // first, then resolve names in a second pass keyed on members.user_id.
    (async () => {
      const { data } = await supabase
        .from("applications")
        .select(
          `id, status, submitted_at, applicant_id,
           application_rankings(rank, ranked, project:projects(name))`,
        )
        .eq("period_id", selectedPeriodId)
        .in("status", ["submitted", "accepted", "rejected"])
        .order("submitted_at", { ascending: true });

      const rows = (data ?? []) as unknown as (Omit<AppRow, "applicant"> & { applicant_id: string | null })[];
      const ids = [...new Set(rows.map((r) => r.applicant_id).filter((id): id is string => !!id))];
      const byId: Record<string, Applicant> = {};
      if (ids.length) {
        const { data: mem } = await supabase
          .from("members")
          .select("user_id, preferred_firstname, lastname")
          .in("user_id", ids);
        for (const m of (mem ?? []) as Applicant[]) byId[m.user_id] = m;
      }

      setApps(
        rows.map(({ applicant_id, ...r }) => ({
          ...r,
          applicant: applicant_id
            ? byId[applicant_id] ?? { user_id: applicant_id, preferred_firstname: null, lastname: null }
            : null,
        })),
      );
    })();

    if (isExec) { setStats(null); loadStats(selectedPeriodId); }
    else setStats(null);
  }, [selectedPeriodId, isExec, loadStats]);

  const selectedPeriod = periods?.find((p) => p.id === selectedPeriodId) ?? null;

  const onReviewed = (id: string, status: ReviewStatus) => {
    setApps((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, status } : a)) : prev));
    if (isExec && selectedPeriodId) loadStats(selectedPeriodId);
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/manager" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Applications</h1>
        <p className="text-sm text-muted-foreground">
          Review submitted applications and accept applicants into a project. Tip: use
          &ldquo;View as&rdquo; (bottom-right) to preview the accepted-member experience.
        </p>
      </div>

      {/* Period bar */}
      <div className="flex flex-wrap items-center gap-3">
        {periods === null ? (
          <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
        ) : periods.length === 0 ? (
          <span className="text-sm text-muted-foreground">No application periods yet.</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                <span className="font-medium">{selectedPeriod?.name ?? "Select period"}</span>
                {selectedPeriod && <PeriodStatusText period={selectedPeriod} />}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {periods.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setSelectedPeriodId(p.id)} className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <PeriodStatusText period={p} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isExec && (
          <Button variant="outline" size="sm" onClick={() => setPeriodsDialogOpen(true)}>
            <SlidersHorizontal size={14} className="mr-1.5" />
            Manage periods
          </Button>
        )}
      </div>

      {/* Exec-only period funnel stats */}
      {isExec && selectedPeriodId && <ApplicationStats stats={stats} />}

      {/* Applications list */}
      {apps === null ? (
        <ApplicationListSkeleton rows={4} />
      ) : apps.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
          No submitted applications for this period yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {apps.map((a) => {
            const ranked = a.application_rankings.filter((r) => r.ranked).sort((x, y) => x.rank - y.rank);
            const name = applicantName(a);
            return (
              <div key={a.id} className="flex items-center gap-3 border rounded-xl px-4 py-3">
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <PersonName userId={a.applicant?.user_id} name={name} className="text-sm font-medium" />
                    <StatusBadge status={a.status} />
                  </div>
                  <span className="text-xs text-muted-foreground truncate">
                    {ranked.length} ranked project{ranked.length === 1 ? "" : "s"}
                    {ranked[0]?.project?.name ? ` · top: ${ranked[0].project.name}` : ""}
                    {a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReviewFor({ id: a.id, name, status: a.status })}
                >
                  Review
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {isExec && periods && (
        <ApplicationPeriodsDialog
          open={periodsDialogOpen}
          onOpenChange={setPeriodsDialogOpen}
          periods={periods}
          onChanged={loadPeriods}
        />
      )}

      {reviewFor && (
        <ApplicationReviewModal
          applicationId={reviewFor.id}
          applicantName={reviewFor.name}
          status={reviewFor.status}
          open={!!reviewFor}
          onOpenChange={(o) => { if (!o) setReviewFor(null); }}
          onReviewed={(status) => onReviewed(reviewFor.id, status)}
        />
      )}
    </div>
  );
}
