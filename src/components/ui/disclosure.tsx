"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Progressive disclosure for optional fields (DESIGN.md): required fields stay
 * in view, everything optional sits behind "More options". Opens with a height
 * animation (grid-rows 0fr → 1fr, so no measuring), and starts open when any
 * field inside already has a value, so an edit form never hides set data.
 */
export function Disclosure({
  label = "More options",
  defaultOpen = false,
  hint,
  children,
  className,
}: {
  label?: string;
  /** Pass true when any field inside has a value. */
  defaultOpen?: boolean;
  /** Muted summary after the label while closed, e.g. "icon, colour". */
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  // Clip only while the height animates; once open and settled, let absolutely
  // positioned children (the icon picker's panel) spill out normally.
  const [settled, setSettled] = React.useState(defaultOpen);
  // With reduced motion there's no transition (and no transitionend).
  React.useEffect(() => {
    if (open && window.matchMedia("(prefers-reduced-motion: reduce)").matches) setSettled(true);
  }, [open]);
  const id = React.useId();
  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setSettled(false);
          setOpen((o) => !o);
        }}
        className="group inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
      >
        <ChevronDown
          size={14}
          aria-hidden
          className={cn("transition-transform duration-2 ease-out-quart", !open && "-rotate-90")}
        />
        {label}
        {!open && hint && <span className="font-normal text-muted-foreground/70">· {hint}</span>}
      </button>
      <div
        id={id}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-2 ease-out-quart motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        // Closed content is out of the tab order and the accessibility tree.
        inert={!open}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && open) setSettled(true);
        }}
      >
        {/* Side/bottom padding so focus rings on fields inside are not clipped. */}
        <div className={cn("-mx-1 min-h-0 px-1 pb-1", open && settled ? "overflow-visible" : "overflow-hidden")}>
          <div className="flex flex-col gap-4 pt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
