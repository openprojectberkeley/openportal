import { cn } from "@/lib/utils";

// Low-level placeholder block. Pulses gently while content loads; compose these
// into layout-shaped skeletons (see components/skeletons.tsx) rather than
// falling back to a bare "Loading..." string.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
