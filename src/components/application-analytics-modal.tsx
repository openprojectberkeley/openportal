"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricBar } from "@/components/metric-bar";
import { PersonName } from "@/components/person-profile-provider";
import { cn } from "@/lib/utils";
import { staggerStyle } from "@/lib/motion";
import { pct, type InvalidRow, type RecruitingAnalytics } from "@/lib/use-recruiting-analytics";

// The Overview, Applicants and Retention tabs of the exec analytics modal
// (AnalyticsModal owns the period picker, the tabs and the one fetch).

// ---- shared bits ----------------------------------------------------------

export function Section({
  title,
  count,
  hint,
  action,
  index = 0,
  children,
}: {
  title: string;
  count?: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 animate-fade-in-up" style={staggerStyle(index)}>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold tracking-tight">
          {title}
          {count != null && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h3>
        {hint && <InfoHint>{hint}</InfoHint>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function BarsSkeleton({ rows, sections = 1 }: { rows: number; sections?: number }) {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      {Array.from({ length: sections }, (_, s) => (
        <div key={s} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-32 rounded-full" />
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3.5 w-32 shrink-0 rounded-full sm:w-48" />
              <Skeleton className="h-1.5 flex-1 rounded-full" />
              <Skeleton className="h-3 w-10 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Stat({ value, label, extra }: { value: React.ReactNode; label: string; extra?: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="font-display text-2xl font-bold tracking-tight tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground">
        {label}
        {extra}
      </span>
    </span>
  );
}

// ---- Overview -------------------------------------------------------------

export function OverviewTab({ data }: { data: RecruitingAnalytics }) {
  const [listOpen, setListOpen] = useState(false);
  const h = data.headline;
  const u = data.undrafted;
  const delta = h.applicantsDelta;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 animate-fade-in-up">
        <Stat
          value={h.applicants}
          label="applicants"
          extra={
            delta != null && delta !== 0 ? (
              <span className="ml-1.5 font-mono text-xs">
                {delta > 0 ? "+" : "−"}
                {Math.abs(delta)} vs {data.previousName}
              </span>
            ) : null
          }
        />
        <Stat value={h.drafted} label="drafted" extra={<span className="ml-1">({pct(h.drafted, h.applicants)}%)</span>} />
        <Stat value={h.onTeam} label="on a team" />
        <Stat value={`${pct(h.returning, h.applicants)}%`} label="returning" />
        <Stat value={`${pct(h.meetsRequirements, h.considered)}%`} label="meet requirements" />
      </div>

      <Section
        title="Funnel"
        index={1}
        hint="Submitted is a share of Started; every later step is a share of Submitted. Steps aren't strictly nested: someone can be drafted without meeting requirements."
      >
        <div className="flex flex-col gap-2.5">
          {data.funnel.map((step, i) => {
            const prev = i === 0 ? null : i === 1 ? data.funnel[0].count : data.funnel[1].count;
            return (
              <MetricBar
                key={step.label}
                index={i}
                label={
                  <span className="inline-flex items-center gap-1">
                    {step.label}
                    {step.hint && <InfoHint>{step.hint}</InfoHint>}
                  </span>
                }
                meta={prev != null ? `${pct(step.count, prev)}%` : undefined}
                value={step.count}
                max={data.funnel[0].count}
              />
            );
          })}
        </div>
      </Section>

      <Section
        title="Why undrafted"
        count={u.total}
        index={2}
        hint="Applicants still pending: submitted, not drafted and not rejected."
        action={
          data.invalid.length > 0 ? (
            <button
              type="button"
              onClick={() => setListOpen(true)}
              className="group inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              View list
              <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          ) : null
        }
      >
        {u.total === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {[
              ["Missing coffee chat", u.missingCoffee],
              ["Missing info session", u.missingInfo],
              ["Missing both", u.missingBoth],
              ["Met requirements, not picked", u.metNotPicked],
            ].map(([label, n], i) => (
              <MetricBar
                key={label as string}
                index={i}
                label={label}
                value={n as number}
                max={u.total}
                display={
                  <>
                    {n}
                    <span className="ml-1.5 font-normal text-muted-foreground">{pct(n as number, u.total)}%</span>
                  </>
                }
              />
            ))}
          </div>
        )}
      </Section>

      <InvalidDialog open={listOpen} onOpenChange={setListOpen} rows={data.invalid} />
    </div>
  );
}

function invalidName(r: InvalidRow): string {
  return [r.preferred_firstname, r.lastname].filter(Boolean).join(" ") || "Applicant";
}

function InvalidDialog({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: InvalidRow[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Missing requirements
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{rows.length}</span>
          </DialogTitle>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everyone submitted meets the requirements.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {rows.map((r) => (
              <li
                key={r.applicant_id}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-foreground/[0.03]"
              >
                <PersonName userId={r.applicant_id} name={invalidName(r)} className="min-w-0 truncate text-sm font-medium" />
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  {!r.did_complete && (
                    <span className={cn(r.has_chat && "text-warning")}>
                      {r.has_chat ? "Coffee chat not done" : "No coffee chat"}
                    </span>
                  )}
                  {!r.did_complete && !r.did_att && " · "}
                  {!r.did_att && "No info session"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Applicants -----------------------------------------------------------

export function ApplicantsTab({ data }: { data: RecruitingAnalytics }) {
  const a = data.applicants;
  if (a.total === 0) return <p className="text-sm text-muted-foreground">No submitted applications yet.</p>;

  const share = (n: number) => (
    <>
      {pct(n, a.total)}%<span className="ml-1.5 font-normal text-muted-foreground">{n}</span>
    </>
  );
  const yearMax = Math.max(...a.classYears.map((c) => c.count));
  const majorMax = Math.max(a.majors[0]?.count ?? 0, a.otherMajors.count);
  const classMax = Math.max(...a.classes.map((c) => c.count), 0);
  const answered = Math.max(...a.interests.map((i) => i.answered), 0);

  return (
    <div className="flex flex-col gap-8">
      <Section title="Class year" count={a.total} index={0}>
        <div className="flex flex-col gap-2.5">
          {a.classYears.map((c, i) => (
            <MetricBar key={c.label} index={i} label={c.label} value={c.count} max={yearMax} display={share(c.count)} />
          ))}
        </div>
      </Section>

      <Section title="Majors" hint="Double majors count once for each major." index={1}>
        <div className="flex flex-col gap-2.5">
          {a.majors.map((m, i) => (
            <MetricBar key={m.label} index={i} label={m.label} value={m.count} max={majorMax} display={share(m.count)} />
          ))}
          {a.otherMajors.distinct > 0 && (
            <MetricBar
              index={a.majors.length}
              label="Other"
              meta={`${a.otherMajors.distinct} majors`}
              value={a.otherMajors.count}
              max={majorMax}
              display={share(a.otherMajors.count)}
            />
          )}
        </div>
      </Section>

      <Section
        title="Technical interests"
        count={answered < a.total ? `${answered} answered` : undefined}
        hint="Average self-rating from 1 to 5, and the share who rated the area 4 or 5."
        index={2}
      >
        <div className="flex flex-col gap-2.5">
          {a.interests.map((t, i) => (
            <MetricBar
              key={t.key}
              index={i}
              label={t.label}
              value={t.avg}
              max={5}
              display={
                <>
                  {t.avg.toFixed(1)}
                  <span className="ml-1.5 font-normal text-muted-foreground">{pct(t.high, t.answered)}%</span>
                </>
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Classes taken" index={3}>
        <div className="flex flex-col gap-2.5">
          {a.classes.map((c, i) => (
            <MetricBar key={c.label} index={i} label={c.label} value={c.count} max={classMax} display={share(c.count)} />
          ))}
        </div>
      </Section>

      <Section title="Materials" index={4}>
        <div className="flex flex-col gap-2.5">
          <MetricBar label="Resume on file" value={a.withResume} max={a.total} display={share(a.withResume)} />
          <MetricBar index={1} label="Portfolio link" value={a.withPortfolio} max={a.total} display={share(a.withPortfolio)} />
        </div>
      </Section>
    </div>
  );
}

// ---- Retention ------------------------------------------------------------

export function RetentionTab({
  data,
  periodId,
  onPeriodChange,
}: {
  data: RecruitingAnalytics;
  periodId: string;
  onPeriodChange: (id: string) => void;
}) {
  const r = data.retention;
  const acc = r.acceptance;
  const newRate = pct(acc.newAccepted, acc.newApplicants);
  const retRate = pct(acc.returningAccepted, acc.returningApplicants);
  const cb = r.cameBack;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 animate-fade-in-up">
        {cb && cb.previousAccepted > 0 ? (
          <Stat
            value={`${pct(cb.applied, cb.previousAccepted)}%`}
            label={`came back: ${cb.applied} of ${cb.previousAccepted} accepted in ${data.previousName} applied again`}
          />
        ) : (
          <span className="text-sm text-muted-foreground">No earlier period to compare against.</span>
        )}
      </div>

      <Section title="Acceptance rate" index={1}>
        <div className="flex flex-col gap-2.5">
          <MetricBar
            label="First-time"
            meta={acc.newApplicants}
            value={newRate}
            max={100}
            display={`${newRate}%`}
          />
          <MetricBar
            index={1}
            label="Returning"
            meta={acc.returningApplicants}
            value={retRate}
            max={100}
            display={`${retRate}%`}
          />
        </div>
      </Section>

      <Section title="By period" count={r.periods.length} index={2} hint="Repeat: applied in an earlier period too. Click a row to switch period.">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Period</th>
                <th className="px-2 py-1.5 text-right font-medium">Applicants</th>
                <th className="px-2 py-1.5 text-right font-medium">Returning</th>
                <th className="px-2 py-1.5 text-right font-medium">Repeat</th>
                <th className="px-2 py-1.5 text-right font-medium">Drafted</th>
                <th className="px-2 py-1.5 text-right font-medium">Accepted</th>
              </tr>
            </thead>
            <tbody>
              {r.periods.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => onPeriodChange(p.id)}
                  className={cn(
                    "cursor-pointer even:bg-foreground/[0.025] hover:bg-foreground/[0.05]",
                    p.id === periodId && "font-semibold",
                  )}
                >
                  <td className="rounded-l-md px-2 py-1.5">{p.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">{p.applicants}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">{pct(p.returning, p.applicants)}%</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">{p.repeat}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">{pct(p.drafted, p.applicants)}%</td>
                  <td className="rounded-r-md px-2 py-1.5 text-right font-mono text-xs">{p.accepted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
