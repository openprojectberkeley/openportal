"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { centredOriginFromClick } from "@/lib/click-origin";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] ease-out-quart data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:duration-3 data-[state=closed]:duration-[150ms]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Mounts with the dialog content (Radix only renders Content while open) and,
 * before first paint, points the content's transform-origin at the press that
 * opened it. Renders nothing.
 */
function OriginFromClick() {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const content = ref.current?.parentElement;
    if (content) content.style.transformOrigin = centredOriginFromClick();
  }, []);
  return <span ref={ref} hidden />;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Centred with inset + auto margins, not translate(-50%): the enter/exit
        // keyframes own `transform`, and a translate-centred box would start
        // its animation half a viewport down and to the right.
        "fixed inset-0 z-50 m-auto h-fit max-h-[calc(100svh-2rem)] w-full max-w-lg rounded-lg border glass-strong p-6 shadow-overlay",
        // Grows out of whatever was pressed to open it (OriginFromClick), and
        // shrinks back toward it on close, faster than it came.
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-50 data-[state=open]:duration-[280ms] data-[state=open]:ease-out-expo",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-75 data-[state=closed]:duration-[150ms] data-[state=closed]:ease-out-quart",
        className,
      )}
      {...props}
    >
      <OriginFromClick />
      {children}
      <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogClose>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />
);

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-display text-lg font-semibold tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose };
