import { cn } from "@/lib/utils";

// Low-level placeholder block. Pulses gently while content loads; compose these
// into layout-shaped skeletons (see components/skeletons.tsx) rather than
// falling back to a bare "Loading..." string. A foreground tint (not bg-muted)
// so it reads in both themes. Text lines: match the text's height (h-3.5 for
// text-sm, h-3 for text-xs) and add rounded-full.
// A block-level <span> rather than a <div>, so a placeholder is valid HTML
// anywhere its text would be -- inside a <p>, a heading or a button.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      className={cn("block animate-pulse rounded-md bg-foreground/[0.09]", className)}
      {...props}
    />
  );
}

export { Skeleton };
