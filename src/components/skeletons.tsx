import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Pencil, Plus, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/back-link";
import { SubscribeMenu } from "@/components/calendar-subscribe-menu";
import { WEEKDAYS_SHORT, weekdayLabels } from "@/lib/dates";

// Layout-shaped loading placeholders. Each mirrors the real component's
// container, grid, and rhythm so a loading screen previews where content lands
// instead of collapsing to a single line of text.

// Mirrors PortalCard: bg-muted card, h-12 icon tile + text-base name, and the
// always-two-lines-tall description.
function PortalCardSkeleton({ i = 0 }: { i?: number }) {
  return (
    <div className="rim-card flex h-full flex-col border rounded-xl bg-muted p-5">
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 flex-shrink-0 rounded-xl" />
          <Skeleton className={`h-4 rounded-full ${["w-28", "w-36", "w-24", "w-32"][i % 4]}`} />
        </div>
        <div className="flex min-h-[2lh] flex-col justify-around text-sm">
          <Skeleton className="h-3.5 w-full rounded-full" />
          <Skeleton className="h-3.5 w-2/3 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// Mirrors the dashboard "Portals" grid (grid-cols-1 sm:grid-cols-2 auto-rows-fr).
export function PortalGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-4">
      {Array.from({ length: count }, (_, i) => (
        <PortalCardSkeleton key={i} i={i} />
      ))}
    </div>
  );
}

// Mirrors CalendarPanel section for section: Subscribe (dashboard), the
// selected day and its events, the month header + grid, Upcoming, and the
// attendance footer (dashboard). Static controls render for real; only the
// date labels (unknown until the client clock is read) and events are shapes.
// `portal` adds the accent tab PortalBackingCard draws behind the card.
export function CalendarSkeleton({ variant = "dashboard" }: { variant?: "dashboard" | "portal" }) {
  const dashboard = variant === "dashboard";
  const card = (
    <div className="rounded-xl border p-4 bg-background rim-card">
      {dashboard && <SubscribeMenu className="mb-3 w-full" />}

      <div className="flex flex-col gap-2">
        <div className="flex h-4 items-center justify-between">
          <Skeleton className="h-3 w-32 rounded-full" />
        </div>
        <EventListSkeleton count={2} />
      </div>

      <div className="mt-4 flex flex-col sm:flex-row lg:flex-col gap-4 lg:gap-3">
        <div className="w-full sm:w-1/2 lg:w-full flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex h-6 items-center">
              <Skeleton className="h-3.5 w-28 rounded-full" />
            </div>
            <div aria-hidden className="flex items-center gap-1 text-muted-foreground">
              <span className="text-xs font-medium px-2 py-1">Today</span>
              <span className="p-1"><ChevronLeft size={16} /></span>
              <span className="p-1"><ChevronRight size={16} /></span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS_SHORT.map((w) => (
              <div key={w} className="text-[10px] font-medium text-muted-foreground uppercase py-1 select-none">
                {w}
              </div>
            ))}
            {Array.from({ length: 35 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-md bg-foreground/[0.05]" />
            ))}
          </div>
        </div>
        <div className="w-full sm:flex-1 lg:w-full min-w-0 flex flex-col gap-2 pt-3 sm:pt-0 sm:pl-5 lg:pl-0 lg:pt-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</span>
          <EventListSkeleton count={2} />
        </div>
      </div>

      {dashboard && (
        <div className="flex flex-col gap-1.5 mt-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ClipboardCheck size={13} />
            <Skeleton className="h-3 w-20 rounded-full" />
          </div>
        </div>
      )}
    </div>
  );
  if (dashboard) return card;
  return (
    <div className="relative" style={{ marginTop: "1.5rem" }}>
      <div aria-hidden className="absolute inset-x-0 bottom-0 rounded-xl bg-foreground/[0.09]" style={{ top: "-1.5rem" }} />
      <div className="relative">{card}</div>
    </div>
  );
}

// Mirrors the /calendar page: title + toolbar, the period/switcher row, and
// the month grid (CalendarMonthGrid's header row and bordered cells).
export function CalendarPageSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Calendar</h1>
        <div className="flex items-center gap-2">
          <SubscribeMenu />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div aria-hidden className="flex items-center gap-1 text-muted-foreground">
          <span className="rounded-md px-2 py-1 text-xs font-medium">Today</span>
          <span className="p-1"><ChevronLeft size={16} /></span>
          <span className="p-1"><ChevronRight size={16} /></span>
          <span className="ml-1 flex h-6 items-center px-1.5">
            <Skeleton className="h-3.5 w-32 rounded-full" />
          </span>
        </div>
        <ViewSwitcherSkeleton />
      </div>
      <CalendarFiltersSkeleton />
      <MonthGridSkeleton />
      <div className="flex flex-col gap-2">
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-40 rounded-full" />
        </div>
        <EventListSkeleton count={2} className="grid gap-2 sm:grid-cols-2" />
      </div>
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <ClipboardCheck size={13} />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// CalendarWeekGrid's frame: day header, all-day strip, and the scrolling
// hour grid at its fixed height.
export function WeekGridSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      <div className="flex overflow-hidden rounded-t-xl border-x border-t">
        <div className="w-14 shrink-0 border-r" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1 border-b border-r py-1.5 last:border-r-0">
            <Skeleton className="h-2.5 w-6 rounded-full" />
            <Skeleton className="h-5 w-5 rounded-full" />
          </div>
        ))}
      </div>
      <div className="h-7 border-x border-b bg-muted/30" />
      <div className="h-[68vh] rounded-b-xl border-x border-b" />
    </div>
  );
}

// CalendarAgenda: a date column beside each day's event list.
export function AgendaSkeleton({ days = 4 }: { days?: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      {Array.from({ length: days }, (_, d) => (
        <div key={d} className="flex gap-3 sm:gap-4">
          <div className="flex w-14 shrink-0 flex-col items-center gap-1 pt-0.5 sm:w-20">
            <Skeleton className="h-3 w-7 rounded-full" />
            <Skeleton className="h-6 w-7" />
            <Skeleton className="h-3 w-6 rounded-full" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 border-l pl-3 sm:pl-4">
            <EventListSkeleton count={d % 2 === 0 ? 2 : 1} />
          </div>
        </div>
      ))}
    </div>
  );
}

// The /calendar Type and Portal filters (MultiSelectFilter triggers), inert:
// their labels are fixed, and both show once there are events to filter.
export function CalendarFiltersSkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap items-center gap-2">
      {[
        { label: "Type", w: "w-44" },
        { label: "Portal", w: "w-52" },
      ].map((f) => (
        <span key={f.label} className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${f.w}`}>
          <span className="shrink-0 text-muted-foreground">{f.label}</span>
          <span className="min-w-0 flex-1 font-medium text-muted-foreground">All</span>
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        </span>
      ))}
    </div>
  );
}

// The Month/Week/Agenda Segmented (ui/segmented), inert, Month selected.
function ViewSwitcherSkeleton() {
  return (
    <div aria-hidden className="relative inline-flex items-center gap-0.5 rounded-lg border p-0.5">
      {["Month", "Week", "Agenda"].map((l, i) => (
        <span
          key={l}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${i === 0 ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

// CalendarMonthGrid's frame: real weekday header, bordered day cells with a
// date-number placeholder in each.
export function MonthGridSkeleton() {
  return (
    <div aria-hidden>
      <div className="grid grid-cols-7 overflow-hidden rounded-t-xl border-x border-t">
        {weekdayLabels().map((w) => (
          <div key={w} className="select-none border-b px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-b-xl border-l">
        {Array.from({ length: 42 }, (_, i) => (
          <div key={i} className="min-h-[6.5rem] border-b border-r p-1 sm:min-h-[7.5rem] sm:p-1.5">
            <Skeleton className="h-3 w-4 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Mirrors EventCard rows: accent bar, a text-sm title line over a text-xs time
// line, inside the same py-1.5 pl-4 box.
const EVENT_TITLE_WIDTHS = ["w-2/5", "w-1/2", "w-1/3"];
export function EventListSkeleton({ count = 2, className = "flex flex-col gap-2" }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="relative flex flex-col gap-1 rounded-md py-1.5 pl-4 pr-2.5">
          <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-foreground/10" />
          <div className="flex flex-col gap-0.5">
            <div className="flex h-5 items-center">
              <Skeleton className={`h-3.5 rounded-full ${EVENT_TITLE_WIDTHS[i % EVENT_TITLE_WIDTHS.length]}`} />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-1/4 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Mirrors PortalContent: a heading and a few prose lines at the 72ch measure.
function PortalContentSkeleton() {
  return (
    <div aria-hidden className="flex max-w-[72ch] flex-col gap-2.5">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3.5 w-full rounded-full" />
      <Skeleton className="h-3.5 w-11/12 rounded-full" />
      <Skeleton className="h-3.5 w-4/5 rounded-full" />
      <Skeleton className="h-3.5 w-full rounded-full" />
      <Skeleton className="h-3.5 w-2/3 rounded-full" />
    </div>
  );
}

// Mirrors the portal detail page: back link, icon + title with the always-on
// header actions, the page, and the side calendar (above it on phones).
export function PortalDetailSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <BackLink href="/" label="Dashboard" />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Skeleton className="h-8 w-8 flex-shrink-0 rounded-lg" />
            <div className="flex h-[3.25rem] items-center pb-1 -mb-1">
              <Skeleton className="h-9 w-52" />
            </div>
          </div>
          <div aria-hidden className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" disabled tabIndex={-1}>
              <Users size={15} />
              <span className="hidden md:inline">View members</span>
            </Button>
            <Button variant="outline" size="sm" disabled tabIndex={-1}>
              <ClipboardCheck size={15} />
              <span className="hidden md:inline">Attendance</span>
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <PortalContentSkeleton />
        </div>
        <div className="w-full lg:w-80 lg:flex-shrink-0 order-first lg:order-none">
          <CalendarSkeleton variant="portal" />
        </div>
      </div>
    </div>
  );
}

// Mirrors ResumeReviewPanel (a surface card: icon circle, title over body,
// trailing arrow) while the latest request loads.
export function ResumeReviewPanelSkeleton({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={`flex items-center rounded-xl surface rim-card ${compact ? "gap-3 px-3 py-2.5" : "gap-3.5 p-4"} ${className ?? ""}`}
    >
      <Skeleton className={`rounded-full flex-shrink-0 ${compact ? "h-8 w-8" : "h-10 w-10"}`} />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-28 rounded-full" /></div>
        <div className="flex h-4 items-center"><Skeleton className="h-3 w-20 rounded-full" /></div>
      </div>
      <ArrowRight size={16} className="text-muted-foreground/30 flex-shrink-0" />
    </div>
  );
}

// The rows of an admin list panel (members, portals, projects, families,
// announcements) while it loads. The panel keeps its real toolbar above; this
// stands in for the list only, with the same px-4 py-3 row box and the pieces
// that panel's rows actually have.
const PANEL_NAME_WIDTHS = ["w-36", "w-28", "w-44", "w-32", "w-40", "w-24", "w-36", "w-28"];
export function PanelRowsSkeleton({
  rows = 5,
  chevron = true,
  icon,
  iconRound = false,
  meta = true,
  extra = false,
  twoLine = false,
  trailing = false,
  status = false,
  actions = true,
  nameBox = "h-5",
}: {
  rows?: number;
  /** The name's line box: h-6 where the real name sits in a taller inline box (members). */
  nameBox?: "h-5" | "h-6";
  chevron?: boolean;
  /** Leading mark size in px (portal icon, family mark, colour dot). */
  icon?: number;
  iconRound?: boolean;
  /** A muted text-xs fact after the name (inline, or under it when twoLine). */
  meta?: boolean;
  /** A second inline text-xs fact (member roles). */
  extra?: boolean;
  twoLine?: boolean;
  /** The hidden-on-phones right-aligned admin names. */
  trailing?: boolean;
  /** A status dot + word before the actions. */
  status?: boolean;
  /** Pencil + X. */
  actions?: boolean;
}) {
  const name = (i: number) => (
    <span className={`flex ${nameBox} items-center`}>
      <Skeleton className={`h-3.5 rounded-full ${PANEL_NAME_WIDTHS[i % PANEL_NAME_WIDTHS.length]}`} />
    </span>
  );
  const fact = (w: string) => (
    <span className="flex h-4 items-center">
      <Skeleton className={`h-3 rounded-full ${w}`} />
    </span>
  );
  return (
    <div aria-hidden className="flex flex-col gap-0.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-4 py-3">
          {chevron && <ChevronRight size={16} className="flex-shrink-0 text-muted-foreground/40" />}
          {icon != null && (
            <Skeleton className={`flex-shrink-0 ${iconRound ? "rounded-full" : "rounded"}`} style={{ width: icon, height: icon }} />
          )}
          {twoLine ? (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {name(i)}
              {meta && fact(["w-40", "w-32", "w-48"][i % 3])}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
              {name(i)}
              {meta && fact(["w-20", "w-16", "w-24"][i % 3])}
              {extra && fact(["w-28", "w-20", "w-36"][i % 3])}
            </div>
          )}
          {trailing && (
            <span className="hidden h-4 items-center sm:flex">
              <Skeleton className="h-2.5 w-24 rounded-full" />
            </span>
          )}
          {status && (
            <span className="flex h-4 shrink-0 items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/[0.15]" />
              <Skeleton className="h-3 w-10 rounded-full" />
            </span>
          )}
          {actions && (
            <>
              <Pencil size={14} className="flex-shrink-0 text-muted-foreground/30" />
              <X size={15} className="flex-shrink-0 text-muted-foreground/30" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// The Members tab's search/filter row, inert (admin page shell and loading.tsx).
function MembersToolbarSkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap gap-3 mb-4">
      <Input placeholder="Search by name..." disabled tabIndex={-1} className="max-w-xs" />
      <span className="flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
        <span className="shrink-0 text-muted-foreground">Role</span>
        <span className="font-medium text-muted-foreground">All</span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
      </span>
      <span className="flex items-center gap-1.5 border rounded-md px-3 py-2 text-sm">Filter by status</span>
    </div>
  );
}

// Mirrors the admin page shell: the real title and tab strip, then the default
// Members tab's toolbar and rows.
export function AdminPageSkeleton() {
  return (
    <div className="p-8 w-full max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Admin</h1>
      <TabStripSkeleton className="mb-6" labels={["Members", "Projects", "Families", "Portals", "Announcements", "Attendance"]} />
      <MembersToolbarSkeleton />
      <PanelRowsSkeleton rows={8} extra actions={false} nameBox="h-6" />
    </div>
  );
}

// Applicant list rows (StaticApplicantCard / ApplicantCard): a plain row with
// the name and a trailing status, between hairline dividers. `compact` is the
// board's tighter px-2 py-1 variant.
const APPLICANT_NAME_WIDTHS = ["w-32", "w-24", "w-36", "w-28", "w-40", "w-24"];
export function ApplicantRowsSkeleton({ rows = 4, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col divide-y divide-foreground/[0.06]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`flex items-center rounded-md ${compact ? "gap-1.5 px-2 py-1" : "gap-2 px-2 py-1.5"}`}>
          <span className="flex h-5 items-center">
            <Skeleton className={`h-3.5 rounded-full ${APPLICANT_NAME_WIDTHS[i % APPLICANT_NAME_WIDTHS.length]}`} />
          </span>
          <span className="ml-auto flex h-4 items-center">
            <Skeleton className="h-3 w-12 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  );
}

// One all-projects board column while it loads: the accent head card (icon,
// name, drafted count), a few compact applicant rows, and the real "Add
// member" ghost row that ends every column.
export function BoardColumnSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="flex w-[300px] shrink-0 flex-col gap-4">
      <div className="flex items-center gap-2.5 rounded-xl bg-foreground/[0.05] px-3 py-2.5">
        <Skeleton className="h-9 w-9 flex-shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-col">
          <span className="flex h-5 items-center"><Skeleton className="h-3.5 w-28 rounded-full" /></span>
          <span className="flex h-4 items-center"><Skeleton className="h-3 w-16 rounded-full" /></span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <ApplicantRowsSkeleton rows={rows} compact />
        <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground/60">
          <Plus size={14} />
          Add member
        </span>
      </div>
    </div>
  );
}

// Mirrors the "Your codes" table rows: code, created (sm+), claimed by, and
// the trailing h-7 delete button column.
export function CodesTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="-mx-4 flex flex-col gap-0.5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 sm:grid-cols-[minmax(0,9rem)_9rem_minmax(0,1fr)_auto]"
        >
          <Skeleton className="h-3.5 w-20 rounded-full" />
          <Skeleton className="hidden h-3.5 w-24 rounded-full sm:block" />
          <Skeleton className="h-3.5 rounded-full" style={{ width: `${[40, 28, 34, 22][i % 4]}%` }} />
          <span className="h-7 w-7" />
        </div>
      ))}
    </div>
  );
}

// Mirrors the host page's booked-chat rows (Upcoming): time line, then an
// attendee sub-row.
export function BookedChatsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-0.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5 px-4 py-3 -mx-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3.5 w-32 rounded-full" />
            <Skeleton className="h-3 w-24 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-3.5 w-28 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Mirrors the booking availability picker: day label + a row of time pills.
export function AvailabilitySkeleton({ days = 2, slots = 5 }: { days?: number; slots?: number }) {
  return (
    <>
      {Array.from({ length: days }, (_, d) => (
        <div key={d} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40 rounded-full" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: slots }, (_, s) => (
              <Skeleton key={s} className="h-[3.25rem] w-24 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// PointsLedger body rows while entries load (the real <thead> stays): one
// text-sm line per cell at the table's px-3 py-2 padding.
const LEDGER_WIDTHS = [44, 120, 72, 24, 168, 80];
export function LedgerRowsSkeleton({ rows = 6, voidColumn = false }: { rows?: number; voidColumn?: boolean }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {LEDGER_WIDTHS.map((w, c) => (
            <td key={c} className="px-3 py-2">
              <div className={`flex h-5 items-center ${c === 3 ? "justify-end" : ""}`}>
                <Skeleton className="h-3.5 rounded-full" style={{ width: Math.round(w * (0.6 + ((r * 7 + c * 3) % 5) / 10)) }} />
              </div>
            </td>
          ))}
          {voidColumn && (
            <td className="px-3 py-2">
              <div className="flex h-5 items-center justify-end">
                <Skeleton className="h-3 w-7 rounded-full" />
              </div>
            </td>
          )}
        </tr>
      ))}
    </>
  );
}

// Name-column placeholder widths for sheet rows (SheetRowsSkeleton).
const NAME_WIDTHS = [62, 48, 70, 55, 66, 44, 58, 72, 50, 64, 46, 60];
// TabStrip (ui/tab-strip) with its static labels, first tab selected, inert:
// the labels never depend on data, only the counts beside them do.
export function TabStripSkeleton({ labels, className }: { labels: string[]; className?: string }) {
  return (
    <div aria-hidden className={`relative flex gap-1 border-b ${className ?? ""}`}>
      {labels.map((l, i) => (
        <span
          key={l}
          className={`relative px-3 py-2 text-sm font-medium capitalize ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}
        >
          {l}
          {i === 0 && <span className="absolute inset-x-0 -bottom-px h-[2px] bg-foreground" />}
        </span>
      ))}
    </div>
  );
}

// Mirrors FamilyScoreboard: the Families/Projects strip, the meta line (the
// semester name is real when known), then one ranked line per family -- chevron,
// w-7 rank, mark, name over meta, inline bar, w-16 points -- with the bar under
// the name on phones.
export function ScoreboardSkeleton({ rows = 4, semesterName }: { rows?: number; semesterName?: string | null }) {
  return (
    <div className="flex flex-col gap-6">
      <TabStripSkeleton labels={["Families", "Projects"]} />
      <div className="flex flex-col gap-6">
        <p className="flex h-5 items-center text-xs text-muted-foreground">
          {semesterName ? (
            <span className="text-sm font-semibold text-foreground">{semesterName}</span>
          ) : (
            <Skeleton className="h-3.5 w-24 rounded-full" />
          )}
          <Skeleton className="ml-2 h-3 w-48 rounded-full" />
        </p>
        <div aria-hidden className="flex flex-col">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <ChevronRight size={16} className="shrink-0 text-muted-foreground/40" />
                <span className="flex w-7 shrink-0 justify-end">
                  <Skeleton className="h-3 w-3 rounded-full" />
                </span>
                <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col sm:w-56 sm:flex-none">
                  <div className="flex h-5 items-center">
                    <Skeleton className={`h-3.5 rounded-full ${["w-28", "w-24", "w-32", "w-20"][i % 4]}`} />
                  </div>
                  <div className="flex h-4 items-center">
                    <Skeleton className="h-3 w-36 rounded-full" />
                  </div>
                </div>
                <Skeleton className="hidden h-1.5 flex-1 rounded-full sm:block" />
                <span className="flex w-16 shrink-0 justify-end">
                  <Skeleton className="h-5 w-8" />
                </span>
              </div>
              <Skeleton className="h-1.5 w-full rounded-full sm:hidden" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Mirrors FamilyStandingsCompact in the dashboard sidebar: the real
// "Standings" heading and "View all" link, the semester line, then compact
// ranked rows each over a thin bar.
export function ScoreboardCompactSkeleton({ rows = 4, semesterName }: { rows?: number; semesterName?: string | null }) {
  return (
    <div className="rounded-xl surface rim-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Standings</h2>
        <Link
          href="/scoreboard"
          className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all
          <ArrowRight size={12} className="transition-transform duration-instant ease-out-quart group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </div>
      <p className="-mt-2 flex h-4 items-center text-[11px] text-muted-foreground">
        {semesterName ?? <Skeleton className="h-2.5 w-20 rounded-full" />}
      </p>
      <div aria-hidden className="flex flex-col gap-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex h-4 items-center gap-2">
              <span className="w-3 flex-shrink-0">
                <Skeleton className="h-2.5 w-2 rounded-full" />
              </span>
              <Skeleton className="h-4 w-4 flex-shrink-0 rounded-md" />
              <Skeleton className={`h-3 rounded-full ${["w-24", "w-20", "w-28", "w-16"][i % 4]}`} />
              <Skeleton className="ml-auto h-3 w-6 rounded-full" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

const ROSTER_ROW_NAME_WIDTHS = [46, 38, 52, 34, 42, 30, 48, 36, 40];

/**
 * Member-roster rows (RosterList, the portal Members modal) while they load or
 * are still on their way at the foot of a progressively loaded list
 * (useProgressiveList). The same row box as the real one -- py-1, a text-sm
 * name, the AdminCrown's p-1 box at `crownSize`, the w-4 remove column -- so
 * heights match exactly. Each row carries the hook's sentinel ref, so
 * scrolling into the skeletons is what loads the real rows behind them.
 */
export function RosterRowsSkeleton({
  rows,
  rowRef,
  crownSize = 14,
  className = "flex flex-col",
}: {
  rows: number;
  rowRef?: React.Ref<HTMLDivElement>;
  crownSize?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} ref={rowRef} className="flex items-center gap-2 py-1 text-sm">
          <span className="flex h-5 min-w-0 flex-1 items-center">
            <Skeleton
              className="h-3.5 rounded-full"
              style={{ width: `${ROSTER_ROW_NAME_WIDTHS[i % ROSTER_ROW_NAME_WIDTHS.length]}%` }}
            />
          </span>
          <span className="inline-flex p-1">
            <Skeleton className="rounded-sm" style={{ width: crownSize, height: crownSize }} />
          </span>
          <span className="w-4 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * The same for the attendance grid: <tr>s to append to its <tbody>, a name
 * under the sticky Member column and a P/A/E-shaped block per event column.
 * `trailing` adds the empty cell under the grid's add-event column.
 */
export function SheetRowsSkeleton({
  rows,
  columns,
  trailing = false,
  rowRef,
}: {
  rows: number;
  columns: number;
  trailing?: boolean;
  rowRef?: React.Ref<HTMLTableRowElement>;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={`skeleton-${r}`} ref={rowRef} aria-hidden>
          <td className="sticky left-0 z-20 bg-background px-3 py-1.5 min-w-[10rem]">
            <Skeleton className="h-3.5 rounded-full" style={{ width: `${NAME_WIDTHS[r % NAME_WIDTHS.length]}%` }} />
          </td>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-2 py-1.5">
              <div className="flex h-[26px] w-[74px] items-center gap-0.5 p-0.5">
                <Skeleton className="h-full flex-1 rounded-sm" />
                <Skeleton className="h-full flex-1 rounded-sm" />
                <Skeleton className="h-full flex-1 rounded-sm" />
              </div>
            </td>
          ))}
          {trailing && <td className="w-12" />}
        </tr>
      ))}
    </>
  );
}
