"use client";

import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Where an explanation lives. DESIGN.md: anything that only explains what a
 * control or number means is not printed on the page; it sits behind this
 * small ? and appears on hover or focus (and on tap, since the trigger is a
 * button). The page shows the thing itself, the hint explains it on demand.
 */
export function InfoHint({
  children,
  label = "More info",
  className,
  side = "top",
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{children}</TooltipContent>
    </Tooltip>
  );
}
