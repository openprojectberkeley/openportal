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
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
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
        <Skeleton className="h-4 w-28" />
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

      <div className="border-t pt-3 flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <EventListSkeleton count={2} />
      </div>
    </div>
  );
}

// Mirrors the CalendarPanel selected-day event rows (bg-accent/40 pills).
export function EventListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-md bg-accent/40 px-2.5 py-2 flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-2/5 bg-foreground/10" />
          <Skeleton className="h-2.5 w-1/4 bg-foreground/10" />
        </div>
      ))}
    </div>
  );
}

// Mirrors the portal detail page: back link, icon + title, side calendar.
export function PortalDetailSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <Skeleton className="h-5 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-9 w-52" />
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0" />
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
      <div className="border rounded-lg overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t" : ""}`}
          >
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-5 w-5 rounded-sm" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-3 w-16" />
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
        {["members", "projects", "portals"].map((t) => (
          <Skeleton key={t} className="h-4 w-16" />
        ))}
      </div>
      <PanelListSkeleton rows={5} />
    </div>
  );
}

// Mirrors the "Your codes" table (header row + body rows).
export function CodesTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-x-auto border rounded-xl">
      <div className="flex items-center gap-4 border-b px-4 py-2.5">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`flex items-center gap-4 px-4 py-3 ${i < rows - 1 ? "border-b" : ""}`}
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
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
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="border rounded-xl px-4 py-3.5 flex items-center gap-3.5 bg-background">
              <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
              <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48 max-w-full" />
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
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-52" />
      </div>
      {children}
    </div>
  );
}

// Mirrors the manager "Upcoming" coffee-chat slot cards.
export function SlotCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="border rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-5 w-10" />
        </div>
      ))}
    </div>
  );
}

// Mirrors CoffeeChatCard: avatar + name/roles and a full-width action button.
function CoffeeChatCardSkeleton() {
  return (
    <div className="border rounded-xl p-5 flex flex-col gap-4 bg-background">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="flex flex-col gap-2 min-w-0">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      </div>
      <Skeleton className="mt-auto h-9 w-full rounded-md" />
    </div>
  );
}

// Mirrors the coffee-chat "Our Team" grid (up to 3 columns).
export function CoffeeTeamSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <CoffeeChatCardSkeleton key={i} />
      ))}
    </div>
  );
}

// Mirrors an available project card: grip + name, description + meta lines.
function AvailableCardSkeleton() {
  return (
    <div className="border rounded-xl p-3 flex flex-col gap-2 bg-background">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded-sm" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="ml-6 h-3 w-11/12" />
      <Skeleton className="ml-6 h-2.5 w-28" />
    </div>
  );
}

// Mirrors a ranked project card row: grip + rank badge + name + type + actions.
function RankedCardSkeleton() {
  return (
    <div className="border rounded-xl p-3 flex items-center gap-2 bg-background">
      <Skeleton className="h-4 w-4 rounded-sm" />
      <Skeleton className="h-6 w-6 rounded-full" />
      <Skeleton className="h-4 w-36" />
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
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Available projects: heading + two type groups of cards. */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-3.5 w-20" />
          {[0, 1].map((g) => (
            <div key={g} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
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
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-8" />
          </div>
          <div className="min-h-40 flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <RankedCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>

      {/* Submit bar. */}
      <div className="border-t pt-6 flex justify-end">
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
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-28 w-full rounded-md" />
        <Skeleton className="h-3 w-40" />
      </div>

      {/* A couple of custom questions: label + control. */}
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}

      {/* Footer actions. */}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </div>
  );
}

// Mirrors the booking availability picker: day label + a row of time pills.
export function AvailabilitySkeleton({ days = 2, slots = 5 }: { days?: number; slots?: number }) {
  return (
    <>
      {Array.from({ length: days }, (_, d) => (
        <div key={d} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
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
