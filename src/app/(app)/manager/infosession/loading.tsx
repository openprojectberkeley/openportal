import { ManagerShellSkeleton, CodesTableSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// Route-transition placeholder: mirrors the page shell + the "Your codes" table
// so navigating in (and the client-component mount gap) shows the same skeleton
// the page renders while it loads, instead of a blank screen.
export default function Loading() {
  return (
    <ManagerShellSkeleton>
      <Skeleton className="h-10 w-44" />
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Your codes</h2>
        <CodesTableSkeleton />
      </div>
    </ManagerShellSkeleton>
  );
}
