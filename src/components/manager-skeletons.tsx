"use client";

import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, FileText, MoreHorizontal, Search, Settings, Table2 } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoHint } from "@/components/ui/info-hint";
import { ManagerMenu } from "@/components/manager-menu";
import { DraftRoundsManagerSkeleton } from "@/components/draft-rounds-manager";
import { ApplicantRowsSkeleton, BookedChatsSkeleton, CodesTableSkeleton } from "@/components/skeletons";
import { rankLabel } from "@/lib/application-rank";

// Page-level loading shapes for the manager and resume-queue routes. Each one
// is its page with the data taken out: back link, title, hints, section
// headings and fixed controls are real (controls inert); only what the page
// fetches is a placeholder. Used by the routes' loading.tsx files and by the
// layouts' auth-guard Suspense fallback, which picks by pathname so a hard load
// of a sub-page doesn't flash the manager menu first.

function PageTitle({ back, backLabel, title, hint }: { back: string; backLabel: string; title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <BackLink href={back} label={backLabel} />
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {hint && <InfoHint label={`About ${title.toLowerCase()}`}>{hint}</InfoHint>}
      </div>
    </div>
  );
}

// ---- /manager/applications ------------------------------------------------

/** "On the team": one surface panel of name rows. */
export function TeamRosterSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="flex flex-col rounded-xl surface p-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2">
          <span className="flex h-5 items-center">
            <Skeleton className={`h-3.5 rounded-full ${["w-28", "w-36", "w-24"][i % 3]}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The applicants list: choice groups with their real headings. */
export function ApplicantGroupsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[3, 2].map((rows, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{rankLabel(gi + 1)}</h3>
          <ApplicantRowsSkeleton rows={rows} />
        </div>
      ))}
    </div>
  );
}

export function ApplicationManagerSkeleton() {
  return (
    <div className="w-full max-w-5xl mx-auto p-5 flex flex-col gap-6">
      <PageTitle
        back="/manager"
        backLabel="Manager"
        title="Applications"
        hint={<>Review submitted applications and accept applicants into a project. Use &ldquo;View as&rdquo; (bottom right) to preview the accepted-member experience.</>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <PickerSkeleton />
      </div>
      <PickerSkeleton width="w-56" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2.5">
            <h2 className="text-base font-semibold tracking-tight">On the team</h2>
            <TeamRosterSkeleton />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold tracking-tight">Applicants</h2>
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shrink-0" disabled tabIndex={-1}>
              <Table2 size={13} className="mr-1.5" />
              Sheet view
            </Button>
          </div>
          <div aria-hidden className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input disabled tabIndex={-1} placeholder="Search applicants…" className="h-8 pl-8 text-xs" />
            </div>
            <span className="flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs">
              <span className="text-muted-foreground">Filter</span>
              <span className="font-medium text-muted-foreground">All</span>
              <ChevronDown size={13} className="text-muted-foreground" />
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Wishlist</h3>
            <div aria-hidden className="min-h-24 rounded-lg bg-foreground/[0.03]" />
          </div>
          <ApplicantGroupsSkeleton />
        </div>
      </div>
    </div>
  );
}

/** A bordered h-9 picker (period / project) whose value is data. */
export function PickerSkeleton({ width = "w-32", label }: { width?: string; label?: string }) {
  return (
    <div aria-hidden className="flex h-9 items-center gap-2 self-start rounded-md border border-input px-3 text-sm shadow-sm">
      {label && <span className="text-muted-foreground">{label}</span>}
      <Skeleton className={`h-3.5 rounded-full ${width}`} />
      <ChevronDown size={14} className="text-muted-foreground" />
    </div>
  );
}

// ---- /manager/coffee-chats ------------------------------------------------

const HOURS = Array.from({ length: 17 }, (_, i) => i + 7);
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const formatHour = (h: number) => (h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`);

export function CoffeeChatsManagerSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BackLink href="/manager" label="Manager" />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">Coffee chats</h1>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
            View everyone&apos;s availability
          </span>
        </div>
        <div className="flex h-6 items-center">
          <Skeleton className="h-3.5 w-48 rounded-full" />
        </div>
      </div>

      <section aria-hidden className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled tabIndex={-1}>
              <ChevronLeft />
            </Button>
            <span className="flex h-6 items-center">
              <Skeleton className="h-4 w-44 rounded-full" />
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled tabIndex={-1}>
              <ChevronRight />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-lg border p-0.5">
              {[15, 20, 30].map((d, i) => (
                <span
                  key={d}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${i === 0 ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}
                >
                  {d}m
                </span>
              ))}
            </div>
            <Button size="sm" disabled tabIndex={-1}>Save</Button>
            <span className="flex h-8 w-8 items-center justify-center text-muted-foreground/50"><Settings size={16} /></span>
            <span className="flex h-8 w-8 items-center justify-center text-muted-foreground/50"><MoreHorizontal size={16} /></span>
          </div>
        </div>

        <div className="overflow-hidden">
          <div className="min-w-[560px] select-none">
            <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-1 mb-1.5">
              <div />
              {DAY_LABELS.map((d) => (
                <div key={d} className="flex flex-col items-center gap-0.5">
                  <p className="text-xs text-muted-foreground">{d}</p>
                  <span className="flex h-6 items-center"><Skeleton className="h-4 w-5" /></span>
                  <p className="h-3.5" />
                </div>
              ))}
            </div>
            <div className="flex flex-col">
              {HOURS.map((hour, hi) => {
                const frame = `${hi === 0 ? "rounded-t-lg" : ""} ${hi === HOURS.length - 1 ? "rounded-b-lg" : "border-b border-b-background"}`;
                return (
                  <div key={hour} className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-1">
                    <div className="flex items-start justify-end pr-2">
                      <span className="text-xs text-muted-foreground leading-none -translate-y-1/2">{formatHour(hour)}</span>
                    </div>
                    {DAY_LABELS.map((d) => (
                      <div key={d} className={`h-9 bg-foreground/[0.03] ${frame}`} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Upcoming</h2>
        <BookedChatsSkeleton />
      </section>
    </div>
  );
}

// ---- /manager/draft -------------------------------------------------------

export function DraftPageSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-6 flex flex-col gap-10">
      <PageTitle
        back="/manager/applications?project=all"
        backLabel="Applications"
        title="Draft"
        hint="Set up draft rounds: the order projects pick in and how many applicants each may take, per round."
      />
      <DraftRoundsManagerSkeleton />
    </div>
  );
}

// ---- /manager/infosession -------------------------------------------------

export function InfosessionPageSkeleton() {
  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-10">
      <PageTitle
        back="/manager"
        backLabel="Manager"
        title="Infosession attendance"
        hint="Generate a code, then read it out to an applicant so they can record their attendance. Each code works once."
      />
      <div className="flex flex-wrap items-center gap-4">
        <Button size="lg" disabled>Generate new code</Button>
      </div>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Your codes</h2>
        </div>
        <CodesTableSkeleton />
      </section>
    </div>
  );
}

// ---- /resume-review/queue -------------------------------------------------

/** Pending-review cards: requester, resume chip, feedback box, send button. */
export function ReviewQueueCardsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="flex flex-col gap-3 rounded-xl surface p-4">
          <div className="flex items-center gap-3 min-w-0">
            <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex h-5 items-center"><Skeleton className="h-3.5 w-32 rounded-full" /></span>
              <span className="flex h-4 items-center"><Skeleton className="h-3 w-24 rounded-full" /></span>
            </div>
          </div>
          <span className="self-start inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
            <FileText size={14} />
            <Skeleton className="h-3 w-24 rounded-full" />
          </span>
          <textarea
            disabled
            tabIndex={-1}
            rows={5}
            placeholder="Your feedback…"
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
          />
          <span className="self-start inline-flex items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background opacity-40">
            Send feedback
          </span>
        </div>
      ))}
    </>
  );
}

export function ResumeQueueSkeleton() {
  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <BackLink href="/resume-review" label="Resume review" />
        <h1 className="text-2xl font-bold tracking-tight">Resume Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Read a requested resume and send written feedback. Submitting notifies the requester.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Waiting</h2>
        <ReviewQueueCardsSkeleton />
      </div>
    </div>
  );
}

// ---- route-guard fallbacks ------------------------------------------------

/** The manager layout's guard fallback: the skeleton of whichever page is loading. */
export function ManagerRouteSkeleton() {
  const path = usePathname() ?? "/manager";
  if (path.startsWith("/manager/applications")) return <ApplicationManagerSkeleton />;
  if (path === "/manager/coffee-chats") return <CoffeeChatsManagerSkeleton />;
  if (path.startsWith("/manager/coffee-chats/")) return <div className="flex-1" />;
  if (path.startsWith("/manager/draft")) return <DraftPageSkeleton />;
  if (path.startsWith("/manager/infosession")) return <InfosessionPageSkeleton />;
  return <ManagerMenu />;
}
