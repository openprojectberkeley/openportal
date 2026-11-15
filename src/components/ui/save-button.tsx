"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Drives a SaveButton's "Saved" state. Call `flash()` the moment a save is
 * accepted — for an optimistic write that's on click, not when the round trip
 * lands, so the confirmation is instant. A failed commit still rolls back and
 * toasts through optimistic().
 *
 * `saved` also suits a `animate-save-ring` on the edited card, for a bigger cue.
 */
export function useSaveFlash(ms = 1400) {
  const [saved, setSaved] = React.useState(0);
  const timer = React.useRef<number | undefined>(undefined);
  const flash = React.useCallback(() => {
    // A counter, not a boolean, so a second save inside the window replays the
    // animation (it's keyed on this) instead of being swallowed.
    setSaved((n) => n + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(0), ms);
  }, [ms]);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  return { saved, flash };
}

/**
 * A Save button that flips to a green "Saved ✓" with a quick bump. Both labels
 * share one grid cell, so the button keeps its width and nothing beside it moves.
 */
export const SaveButton = React.forwardRef<
  HTMLButtonElement,
  ButtonProps & { saved: number; savedLabel?: string }
>(({ saved, savedLabel = "Saved", children = "Save", className, disabled, ...props }, ref) => {
  const on = saved > 0;
  return (
    <Button
      ref={ref}
      key={on ? `saved-${saved}` : "idle"}
      // While confirming, stay solid even though the form is no longer dirty.
      disabled={disabled && !on}
      aria-live="polite"
      className={cn(
        on && "pointer-events-none bg-success text-success-foreground hover:bg-success animate-save-pop motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      <span className="grid place-items-center">
        <span className={cn("col-start-1 row-start-1 inline-flex items-center gap-1.5", on && "invisible")}>
          {children}
        </span>
        <span
          aria-hidden={!on}
          className={cn("col-start-1 row-start-1 inline-flex items-center gap-1", !on && "invisible")}
        >
          <Check strokeWidth={3} />
          {savedLabel}
        </span>
      </span>
    </Button>
  );
});
SaveButton.displayName = "SaveButton";
