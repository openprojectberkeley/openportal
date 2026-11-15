"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    // Portal target. Point this at an open Dialog's content so the popover lives
    // inside the dialog's pointer-events region and focus scope; defaults to body.
    container?: HTMLElement | null;
  }
>(({ className, align = "center", sideOffset = 4, container, ...props }, ref) => (
  <PopoverPrimitive.Portal container={container ?? undefined}>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // `pointer-events-auto` re-enables clicks when this content is portalled
        // into a Radix Dialog (a modal Dialog sets `pointer-events: none` on the
        // body, which the portalled popover would otherwise inherit).
        "pointer-events-auto z-50 w-72 rounded-md border glass p-4 text-popover-foreground shadow-overlay outline-none",
        "ease-out-quart data-[state=open]:duration-2 data-[state=closed]:duration-1 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[.96] data-[state=open]:zoom-in-[.96] data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 origin-[--radix-popover-content-transform-origin]",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
