"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DonutChart, Legend, NEUTRAL, pct, type Segment } from "@/components/donut-chart";

// One row per application period from the application_analytics() RPC (0060).
type Row = {
  period_id: string;
  period_name: string;
  created_at: string;
  empty_drafts: number;
  unfinished_drafts: number;
  submitted: number;
  accepted: number;
  rejected: number;
  coffee_completed: number;
  coffee_booked: number;
  coffee_returning: number;
  coffee_nothing: number;
  info_attended: number;
  info_returning: number;
  info_nothing: number;
};

type Period = { id: string; name: string };

// Long-format demographics row from application_demographics() (0062).
type DemoRow = { dimension: string; bucket: string; cnt: number };

// Horizontal bar list for a demographic breakdown (grad year / returning).
function BarList({ title, items, total }: { title: string; items: { label: string; count: number }[]; total: number }) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0);
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => {
            const w = max === 0 ? 0 : Math.round((it.count / max) * 100);
            return (
              <li key={it.label} className="flex items-center gap-2 text-xs">
                <span className="w-24 flex-shrink-0 truncate text-foreground/90" title={it.label}>
                  {it.label}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full bg-foreground/60" style={{ width: `${w}%` }} />
                </div>
                <span className="w-14 flex-shrink-0 text-right tabular-nums text-muted-foreground">
                  {it.count} ({pct(it.count, total)}%)
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Class standing progression, so "By grad year" reads Freshman → Postgrad rather
// than alphabetically. Unknown/other labels sort after these, then alphabetically.
const CLASS_ORDER: Record<string, number> = {
  freshman: 1, sophomore: 2, junior: 3, senior: 4, "5th year": 5, postgrad: 6, "post-grad": 6, graduate: 6, grad: 6,
};
function classRank(label: string): number {
  return CLASS_ORDER[label.trim().toLowerCase()] ?? (label === "Unknown" ? 99 : 90);
}

const RETURNING_ORDER: Record<string, number> = { Returning: 1, "First-time": 2 };

// Reshape long-format demographics into per-dimension bar items. Grad year sorts
// by class progression (Unknown last); returning sorts Returning → First-time.
function buildDemographics(demo: DemoRow[]) {
  const gradYear = demo
    .filter((d) => d.dimension === "grad_year")
    .map((d) => ({ label: d.bucket, count: d.cnt }))
    .sort((a, b) => classRank(a.label) - classRank(b.label) || a.label.localeCompare(b.label));
  const returning = demo
    .filter((d) => d.dimension === "returning")
    .map((d) => ({ label: d.bucket, count: d.cnt }))
    .sort((a, b) => (RETURNING_ORDER[a.label] ?? 99) - (RETURNING_ORDER[b.label] ?? 99));
  return { gradYear, returning };
}

// Slice colors — aligned with the coffee/info indicator colors used elsewhere
// (green = done, amber = booked, sky = attended, indigo = returning) plus a
// theme-aware neutral for "nothing".
const GREEN = "#16a34a";
const AMBER = "#d97706";
const INDIGO = "#4f46e5";
const SKY = "#0284c7";

function ChartCard({
  title,
  segments,
  validValue,
  submitted,
}: {
  title: string;
  segments: Segment[];
  validValue: number;
  submitted: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex items-center gap-4">
        <DonutChart
          segments={segments}
          total={submitted}
          centerValue={`${pct(validValue, submitted)}%`}
          centerSub={`${validValue}/${submitted}`}
        />
        <div className="min-w-0 flex-1">
          <Legend segments={segments} total={submitted} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Valid: <span className="font-medium text-foreground/90 tabular-nums">{validValue}/{submitted}</span> ({pct(validValue, submitted)}%)
      </p>
    </div>
  );
}

function coffeeSegments(r: Row): Segment[] {
  return [
    { label: "Completed", value: r.coffee_completed, color: GREEN },
    { label: "Booked", value: r.coffee_booked, color: AMBER },
    { label: "Returning (exempt)", value: r.coffee_returning, color: INDIGO },
    { label: "Nothing", value: r.coffee_nothing, color: NEUTRAL },
  ];
}

function infoSegments(r: Row): Segment[] {
  return [
    { label: "Attended", value: r.info_attended, color: SKY },
    { label: "Returning (exempt)", value: r.info_returning, color: INDIGO },
    { label: "Nothing", value: r.info_nothing, color: NEUTRAL },
  ];
}

const submittedTotal = (r: Row) => r.submitted + r.accepted + r.rejected;
const coffeeValid = (r: Row) => r.coffee_completed + r.coffee_booked + r.coffee_returning;
const infoValid = (r: Row) => r.info_attended + r.info_returning;

// Exec analytics for recruiting funnels: per-period pie breakdowns of coffee-chat
// and info-session status plus a historical "valid %" table across all periods.
export function ApplicationAnalyticsModal({
  open,
  onOpenChange,
  periods,
  initialPeriodId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periods: Period[];
  initialPeriodId: string | null;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [demo, setDemo] = useState<DemoRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(initialPeriodId);

  useEffect(() => {
    if (open) setSelectedPeriodId(initialPeriodId);
  }, [open, initialPeriodId]);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    const supabase = createClient();
    (async () => {
      const { data, error: err } = await supabase.rpc("application_analytics");
      if (err) {
        setError(err.message);
        setRows([]);
        return;
      }
      setRows((data as Row[]) ?? []);
    })();
  }, [open]);

  // Demographics (grad year / returning) for the selected period.
  useEffect(() => {
    if (!open || !selectedPeriodId) {
      setDemo([]);
      return;
    }
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.rpc("application_demographics", { p_period_id: selectedPeriodId });
      setDemo((data as DemoRow[]) ?? []);
    })();
  }, [open, selectedPeriodId]);

  const selected =
    rows?.find((r) => r.period_id === selectedPeriodId) ?? rows?.[0] ?? null;
  const selectedName =
    periods.find((p) => p.id === selectedPeriodId)?.name ?? selected?.period_name ?? "Select period";
  const { gradYear, returning } = buildDemographics(demo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recruiting analytics</DialogTitle>
        </DialogHeader>

        {rows === null ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="h-56 rounded-xl border bg-muted animate-pulse" />
              <div className="h-56 rounded-xl border bg-muted animate-pulse" />
            </div>
            <div className="h-40 rounded-xl border bg-muted animate-pulse" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Period selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-between gap-2 self-start rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent transition-colors min-w-[12rem]">
                  <span className="font-medium">{selectedName}</span>
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {periods.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => setSelectedPeriodId(p.id)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {error && <p className="text-sm text-red-500">{error}</p>}

            {selected ? (
              <>
                {/* Funnel recap */}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {[
                    ["Empty", selected.empty_drafts],
                    ["Unfinished", selected.unfinished_drafts],
                    ["Submitted", selected.submitted],
                    ["Accepted", selected.accepted],
                    ["Rejected", selected.rejected],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded-lg border bg-background px-3 py-2">
                      <div className="text-lg font-bold tabular-nums">{value}</div>
                      <div className="text-[0.7rem] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Pies */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ChartCard
                    title="Coffee chat"
                    segments={coffeeSegments(selected)}
                    validValue={coffeeValid(selected)}
                    submitted={submittedTotal(selected)}
                  />
                  <ChartCard
                    title="Info session"
                    segments={infoSegments(selected)}
                    validValue={infoValid(selected)}
                    submitted={submittedTotal(selected)}
                  />
                </div>

                {/* Applicant demographics */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <BarList title="By grad year" items={gradYear} total={submittedTotal(selected)} />
                  <BarList title="Returning vs first-time" items={returning} total={submittedTotal(selected)} />
                </div>

                {/* History */}
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    By period
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1 pr-3 font-medium">Period</th>
                          <th className="py-1 pr-3 font-medium tabular-nums">Submitted</th>
                          <th className="py-1 pr-3 font-medium">Coffee valid</th>
                          <th className="py-1 font-medium">Info valid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const sub = submittedTotal(r);
                          const cv = pct(coffeeValid(r), sub);
                          const iv = pct(infoValid(r), sub);
                          const isSel = r.period_id === selected.period_id;
                          return (
                            <tr
                              key={r.period_id}
                              onClick={() => setSelectedPeriodId(r.period_id)}
                              className={cn(
                                "cursor-pointer border-t hover:bg-accent/50 transition-colors",
                                isSel && "bg-accent/40",
                              )}
                            >
                              <td className="py-1.5 pr-3">{r.period_name}</td>
                              <td className="py-1.5 pr-3 tabular-nums">{sub}</td>
                              <td className="py-1.5 pr-3">
                                <Bar pct={cv} color={GREEN} />
                              </td>
                              <td className="py-1.5">
                                <Bar pct={iv} color={SKY} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No application periods yet.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Bar({ pct: value, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 flex-shrink-0 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="tabular-nums text-xs text-muted-foreground">{value}%</span>
    </div>
  );
}
