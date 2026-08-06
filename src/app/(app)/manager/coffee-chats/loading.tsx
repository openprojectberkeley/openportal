import { ManagerShellSkeleton, SlotCardsSkeleton } from "@/components/skeletons";

// Route-transition placeholder: mirrors the page shell + the "Upcoming" slot
// list so navigating in (and the client-component mount gap) shows the same
// skeleton the page renders while it loads, instead of a blank screen.
export default function Loading() {
  return (
    <ManagerShellSkeleton>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</h2>
        <SlotCardsSkeleton />
      </div>
    </ManagerShellSkeleton>
  );
}
