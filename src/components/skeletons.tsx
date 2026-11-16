import { Skeleton } from "@/components/ui/skeleton";

// Layout-shaped loading placeholders. Each mirrors the real component's
// container, grid, and rhythm so a loading screen previews where content lands
// instead of collapsing to a single line of text.

// Mirrors PortalCard: icon tile + name, two description lines.
function PortalCardSkeleton() {
  return (
    <div className="border rounded-xl p-5 flex flex-col gap-3 bg-background">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <Skeleton className="h-4 w-28 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-3 w-2/3 rounded-full" />
      </div>
    </div>
  );
}

// Mirrors the dashboard "Portals" grid (grid-cols-1 sm:grid-cols-2).
export function PortalGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <PortalCardSkeleton key={i} />
      ))}
    </div>
  );
}

// Mirrors CalendarPanel: header + weekday row + month grid + a couple events.
export function CalendarSkeleton() {
  return (
    <div className="border rounded-xl p-4 flex flex-col gap-3 bg-background">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28 rounded-full" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-6 w-6 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={`w${i}`} className="h-2.5 w-full rounded-sm" />
        ))}
        {Array.from({ length: 35 }, (_, i) => (
          <Skeleton key={`d${i}`} className="aspect-square w-full rounded-md" />
        ))}
      </div>

      <div className="pt-1 flex flex-col gap-2">
        <Skeleton className="h-3 w-32 rounded-full" />
        <EventListSkeleton count={2} />
      </div>
    </div>
  );
}

// Mirrors the /calendar page: title + toolbar, the period/switcher row, and
// the 6x7 month grid.
export function CalendarPageSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-14 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="ml-1 h-4 w-36 rounded-full" />
        </div>
        <Skeleton className="h-9 w-56 rounded-lg" />
      </div>
      <div className="grid grid-cols-7 gap-px rounded-xl border p-px">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={`w${i}`} className="h-6 rounded-sm" />
        ))}
        {Array.from({ length: 42 }, (_, i) => (
          <Skeleton key={`d${i}`} className="h-[6.5rem] rounded-sm sm:h-[7.5rem]" />
        ))}
      </div>
    </div>
  );
}

// Mirrors the CalendarPanel selected-day event rows (bg-accent/40 pills).
export function EventListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="relative flex flex-col gap-1.5 py-1.5 pl-4 pr-2.5">
          <span aria-hidden className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-foreground/10" />
          <Skeleton className="h-3.5 w-2/5 rounded-full" />
          <Skeleton className="h-3 w-1/4 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// Mirrors PortalContent: a few lines of prose filling the main column.
function PortalContentSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3 w-full rounded-full" />
      <Skeleton className="h-3 w-11/12 rounded-full" />
      <Skeleton className="h-3 w-4/5 rounded-full" />
      <Skeleton className="h-3 w-full rounded-full" />
      <Skeleton className="h-3 w-2/3 rounded-full" />
    </div>
  );
}

// Mirrors the portal detail page: back link, icon + title, page, side calendar.
export function PortalDetailSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <Skeleton className="h-5 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-9 w-52" />
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <PortalContentSkeleton />
        </div>
        <div className="w-full lg:w-80 lg:flex-shrink-0">
          <CalendarSkeleton />
        </div>
      </div>
    </div>
  );
}

// Mirrors the admin portals/projects panels: action row + bordered row list.
export function PanelListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3"
          >
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-5 w-5 rounded-sm" />
            <Skeleton className="h-4 w-40 rounded-full" />
            <Skeleton className="ml-auto h-3 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Mirrors the admin page shell: title, tab bar, and the active panel list.
export function AdminPageSkeleton() {
  return (
    <div className="p-8 w-full max-w-5xl mx-auto">
      <Skeleton className="h-7 w-28 mb-6" />
      <div className="flex gap-4 mb-6 border-b pb-2">
        {["members", "projects", "families", "portals", "announcements"].map((t) => (
          <Skeleton key={t} className="h-4 w-16 rounded-full" />
        ))}
      </div>
      <PanelListSkeleton rows={5} />
    </div>
  );
}

// Mirrors the "Your codes" table (header row + body rows).
export function CodesTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="-mx-4 flex flex-col gap-0.5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-4 px-4 py-3 sm:grid-cols-[minmax(0,9rem)_9rem_minmax(0,1fr)]">
          <Skeleton className="h-3.5 w-20 rounded-full" />
          <Skeleton className="hidden h-3.5 w-24 rounded-full sm:block" />
          <Skeleton className="h-3.5 rounded-full" style={{ width: `${[40, 28, 34, 22][i % 4]}%` }} />
        </div>
      ))}
    </div>
  );
}

// Mirrors the portal members roster rows: name bar + admin pill + remove icon.
const MEMBER_NAME_WIDTHS = ["w-40", "w-32", "w-48", "w-36", "w-28", "w-44"];
export function MemberRosterSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <Skeleton className={`h-4 ${MEMBER_NAME_WIDTHS[i % MEMBER_NAME_WIDTHS.length]}`} />
          <Skeleton className="ml-auto h-5 w-12 rounded-full" />
          <Skeleton className="h-4 w-4 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

// Mirrors the Application Manager landing menu (manager/page.tsx): centered
// column with back link, title, and 3 nav cards (icon tile + text + chevron).
// Used as the route-guard Suspense fallback, which most often precedes the menu.
export function ManagerMenuSkeleton() {
  return (
    <div className="flex flex-1 w-full items-center justify-center p-6">
      <div className="flex flex-col gap-8 w-full max-w-md">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-12 rounded-full" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-72 max-w-full rounded-full" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-xl px-4 py-3.5 flex items-center gap-3.5 surface">
              <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
              <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                <Skeleton className="h-4 w-32 rounded-full" />
                <Skeleton className="h-3 w-48 max-w-full rounded-full" />
              </div>
              <Skeleton className="h-4 w-4 rounded-sm flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Shared shell for the manager sub-screens (coffee-chats, infosession): the
// max-w-3xl column plus a back-link + title header, with a slot for the
// page-specific body skeleton. Used by their loading.tsx route segments.
export function ManagerShellSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-8 w-52" />
      </div>
      {children}
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

// Mirrors an available project card: grip + name, description + meta lines.
function AvailableCardSkeleton() {
  return (
    <div className="rounded-xl p-3 flex flex-col gap-2 bg-foreground/[0.04]">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded-sm" />
        <Skeleton className="h-4 w-40 rounded-full" />
      </div>
      <Skeleton className="ml-6 h-3 w-11/12 rounded-full" />
      <Skeleton className="ml-6 h-2.5 w-28 rounded-full" />
    </div>
  );
}

// Mirrors a ranked project card row: grip + rank badge + name + type + actions.
function RankedCardSkeleton() {
  return (
    <div className="rounded-xl p-3 flex items-center gap-2 bg-foreground/[0.04]">
      <Skeleton className="h-4 w-4 rounded-sm" />
      <Skeleton className="h-6 w-6 rounded-full" />
      <Skeleton className="h-4 w-36 rounded-full" />
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="ml-auto h-4 w-4 rounded-sm" />
      <Skeleton className="h-4 w-4 rounded-sm" />
    </div>
  );
}

// Mirrors the applicant application page: header, the two-pane projects/ranking
// grid, and the submit bar. Used as its initial loading state.
export function ApplicationPageSkeleton() {
  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-6">
      {/* Header: back link, title, intro line. */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3.5 w-96 max-w-full rounded-full" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Available projects: heading + two type groups of cards. */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-3.5 w-20 rounded-full" />
          {[0, 1].map((g) => (
            <div key={g} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24 rounded-full" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <AvailableCardSkeleton key={i} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Your ranking: heading + count, then ranked rows. */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-24 rounded-full" />
            <Skeleton className="h-3 w-8 rounded-full" />
          </div>
          <div className="min-h-40 flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <RankedCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>

      {/* Submit bar. */}
      <div className="pt-4 flex justify-end">
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
    </div>
  );
}

// Mirrors the per-project application modal body: the essay block, a couple of
// custom questions, and the footer actions. Rendered inside the open dialog.
export function ProjectApplicationModalSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {/* Essay: label, tall textarea, word-count line. */}
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-64 max-w-full rounded-full" />
        <Skeleton className="h-28 w-full rounded-md" />
        <Skeleton className="h-3 w-40 rounded-full" />
      </div>

      {/* A couple of custom questions: label + control. */}
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-48 max-w-full rounded-full" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}

      {/* Footer actions. */}
      <div className="flex justify-end gap-2 pt-2">
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </div>
  );
}

// Mirrors an application review row (manager/applications): applicant name +
// status badge, a meta line, and the right-aligned "Review" button.
const APP_ROW_NAME_WIDTHS = ["w-32", "w-40", "w-28", "w-44", "w-36"];
export function ApplicationListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3 surface">
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Skeleton className={`h-4 ${APP_ROW_NAME_WIDTHS[i % APP_ROW_NAME_WIDTHS.length]}`} />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-56 max-w-full rounded-full" />
          </div>
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

// Mirrors the full manager/applications page: header (back link, title, intro),
// the period-selector bar, and the applications list. Used by its loading.tsx.
export function ApplicationManagerSkeleton() {
  return (
    <div className="w-full max-w-3xl mx-auto p-5 flex flex-col gap-6">
      {/* Header: back link, title, two intro lines. */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-3.5 w-full max-w-lg rounded-full" />
        <Skeleton className="h-3.5 w-64 max-w-full rounded-full" />
      </div>

      {/* Period bar: selector button + manage-periods button. */}
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-48 rounded-md" />
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>

      <ApplicationListSkeleton rows={4} />
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
              <Skeleton key={s} className="h-9 w-20 rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// Mirrors PointsLedger: a header row plus body rows of the points table.
export function LedgerSkeleton({ rows = 6 }: { rows?: number }) {
  return <SheetGridSkeleton rows={rows} columns={[48, 112, 80, 32, 160, 72]} />;
}

// A sheet (attendance, application sheet, ledger) while it loads: the real
// grid's shape -- a header row, a sticky-name column, zebra rows, one
// placeholder per cell -- rather than a stack of text lines. `cells: "pae"`
// draws the attendance sheet's three-letter control in every cell.
const NAME_WIDTHS = [62, 48, 70, 55, 66, 44, 58, 72, 50, 64, 46, 60];
export function SheetGridSkeleton({
  rows = 12,
  columns = [96, 96, 96, 96, 96, 96],
  cells = "text",
}: {
  rows?: number;
  /** Approximate pixel width of each data column's placeholder. */
  columns?: number[];
  cells?: "text" | "pae";
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden" aria-hidden>
      <table className="sheet-zebra w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="w-40 min-w-[10rem] px-3 py-2.5 text-left">
              <Skeleton className="h-3 w-14 rounded-full" />
            </th>
            {columns.map((w, i) => (
              <th key={i} className="px-2 py-2.5 text-left">
                <div className="flex flex-col gap-1.5">
                  {cells === "pae" && <Skeleton className="h-2.5 w-12 rounded-full" />}
                  <Skeleton className="h-3 rounded-full" style={{ width: Math.min(w, 88) }} />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <td className="px-3 py-2">
                <Skeleton className="h-3.5 rounded-full" style={{ width: `${NAME_WIDTHS[r % NAME_WIDTHS.length]}%` }} />
              </td>
              {columns.map((w, c) => (
                <td key={c} className="px-2 py-2">
                  {cells === "pae" ? (
                    <div className="flex w-[4.5rem] items-center gap-1">
                      <Skeleton className="h-5 flex-1 rounded-sm" />
                      <Skeleton className="h-5 flex-1 rounded-sm" />
                      <Skeleton className="h-5 flex-1 rounded-sm" />
                    </div>
                  ) : (
                    <Skeleton className="h-3.5 rounded-full" style={{ width: Math.max(16, w * (0.55 + ((r * 7 + c * 3) % 5) / 10)) }} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Mirrors the /scoreboard page: the meta line, then one ranked line per family
// (rank, mark, name, inline bar, total), with the bar under the name on phones.
export function ScoreboardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-3.5 w-64 rounded-full" />
      <div className="flex flex-col">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-3 w-5 rounded-full" />
              <Skeleton className="h-7 w-7 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:w-56 sm:flex-none">
                <Skeleton className="h-3.5 w-28 rounded-full" />
                <Skeleton className="h-3 w-36 rounded-full" />
              </div>
              <Skeleton className="hidden h-1.5 flex-1 rounded-full sm:block" />
              <Skeleton className="h-5 w-10" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full sm:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Mirrors FamilyScoreboardCard in the dashboard sidebar: label, then compact
// ranked rows each over a thin bar.
export function ScoreboardCompactSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3 surface">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20 rounded-full" />
        <Skeleton className="h-3 w-12 rounded-full" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-2.5 w-2 rounded-full" />
            <Skeleton className="h-4 w-4 rounded-md" />
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="ml-auto h-3 w-8 rounded-full" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

const ROSTER_ROW_NAME_WIDTHS = [46, 38, 52, 34, 42, 30, 48, 36, 40];

/**
 * Rows still on their way at the foot of a progressively loaded member list
 * (useProgressiveList): a name, the crown column, the remove column. Each row
 * carries the hook's sentinel ref, so scrolling into the skeletons is what
 * loads the real rows behind them.
 */
export function RosterRowsSkeleton({
  rows,
  rowRef,
}: {
  rows: number;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} ref={rowRef} className="flex h-7 items-center gap-2">
          <Skeleton
            className="h-3.5 rounded-full"
            style={{ width: `${ROSTER_ROW_NAME_WIDTHS[i % ROSTER_ROW_NAME_WIDTHS.length]}%` }}
          />
          <span className="flex-1" />
          <Skeleton className="h-3.5 w-3.5 rounded-sm" />
          <span className="w-4" />
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
