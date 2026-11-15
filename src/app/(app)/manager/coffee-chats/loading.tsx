import { Skeleton } from "@/components/ui/skeleton";
import { BookedChatsSkeleton } from "@/components/skeletons";

// Route-transition placeholder: mirrors the host page's shell (title,
// toolbar, availability grid) and its "Upcoming" rows, so navigating in shows
// the same layout the page renders while it loads.
export default function Loading() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-7 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
      <Skeleton className="h-[22rem] w-full rounded-xl" />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Upcoming</h2>
        <BookedChatsSkeleton />
      </section>
    </div>
  );
}
