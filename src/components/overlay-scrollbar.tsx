"use client";

import * as React from "react";
import { useOverlayScrollbar } from "@/hooks/use-overlay-scrollbar";
import { cn } from "@/lib/utils";

// Idle vs active thumb opacity. Faint but present when idle; brighter while
// scrolling / hovering / dragging.
const IDLE_OPACITY = 0.15;
const ACTIVE_OPACITY = 0.5;
const THUMB_THICKNESS = 6; // px, idle
const THUMB_THICKNESS_ACTIVE = 8; // px, active
const EDGE_INSET = 2; // px gap from the track edge

/**
 * Window-level overlay scrollbar. Fixed to the right edge of the viewport,
 * vertical only, mounted once app-wide. If a fixed header is present (an element
 * tagged `data-app-header`, e.g. AppNavbar), the track starts below it so the
 * scrollbar never underlaps the header. Renders nothing when the page doesn't
 * overflow.
 */
export function WindowScrollbar() {
  const [target, setTarget] = React.useState<Window | null>(null);
  React.useEffect(() => setTarget(window), []);

  const { scrollable, sizeRatio, offsetRatio, active, dragging, onThumbPointerDown } =
    useOverlayScrollbar({ target, orientation: "vertical" });
  const [hovered, setHovered] = React.useState(false);

  // Offset the track below any fixed header so it never underlaps it. The header
  // mounts/unmounts per route (this component persists in the root layout), so
  // watch the DOM for it appearing/disappearing and re-measure on resize.
  // (A MutationObserver, not usePathname — reading the pathname would opt this
  // root-layout component into dynamic rendering and break PPR.)
  const [headerOffset, setHeaderOffset] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const header = document.querySelector<HTMLElement>("[data-app-header]");
        setHeaderOffset(header?.offsetHeight ?? 0);
      });
    };
    measure();
    window.addEventListener("resize", measure);
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      mo.disconnect();
    };
  }, []);

  if (!scrollable) return null;

  const shown = active || hovered;
  const thickness = shown ? THUMB_THICKNESS_ACTIVE : THUMB_THICKNESS;

  return (
    <div
      aria-hidden
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="fixed z-50"
      style={{
        top: headerOffset,
        height: `calc(100vh - ${headerOffset}px)`,
        right: EDGE_INSET,
        width: THUMB_THICKNESS_ACTIVE + EDGE_INSET,
        pointerEvents: "none",
      }}
    >
      <div
        onPointerDown={onThumbPointerDown}
        className={cn(
          "absolute right-0 rounded-full bg-foreground",
          !dragging && "transition-[opacity,width] duration-200 ease-out",
        )}
        style={{
          top: `${offsetRatio * (1 - sizeRatio) * 100}%`,
          height: `${sizeRatio * 100}%`,
          width: thickness,
          opacity: shown ? ACTIVE_OPACITY : IDLE_OPACITY,
          minHeight: 24,
          pointerEvents: "auto",
          cursor: "pointer",
          touchAction: "none",
        }}
      />
    </div>
  );
}

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "vertical" | "horizontal" | "both";
  /** Optional class for the inner scrolling viewport. */
  viewportClassName?: string;
};

/**
 * Scrollable container with custom overlay scrollbar(s). Drop-in replacement for
 * a `<div class="overflow-y-auto">` wrapper: className sizes the outer box (e.g.
 * max-h-[90vh]); children are the scrollable content.
 */
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, viewportClassName, orientation = "vertical", children, ...props }, ref) => {
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const [el, setEl] = React.useState<HTMLDivElement | null>(null);
    const [hovered, setHovered] = React.useState(false);

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        viewportRef.current = node;
        setEl(node);
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref],
    );

    const showV = orientation === "vertical" || orientation === "both";
    const showH = orientation === "horizontal" || orientation === "both";

    return (
      <div
        className={cn("relative", className)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        {...props}
      >
        <div
          ref={setRefs}
          className={cn(
            "h-full w-full",
            showV && "overflow-y-auto",
            showH && "overflow-x-auto",
            !showV && "overflow-y-hidden",
            !showH && "overflow-x-hidden",
            viewportClassName,
          )}
        >
          {children}
        </div>
        {showV && <ElementScrollbar target={el} orientation="vertical" hovered={hovered} />}
        {showH && <ElementScrollbar target={el} orientation="horizontal" hovered={hovered} />}
      </div>
    );
  },
);
ScrollArea.displayName = "ScrollArea";

function ElementScrollbar({
  target,
  orientation,
  hovered,
}: {
  target: HTMLElement | null;
  orientation: "vertical" | "horizontal";
  hovered: boolean;
}) {
  const { scrollable, sizeRatio, offsetRatio, active, dragging, onThumbPointerDown } =
    useOverlayScrollbar({ target, orientation });

  if (!scrollable) return null;

  const shown = active || hovered;
  const thickness = shown ? THUMB_THICKNESS_ACTIVE : THUMB_THICKNESS;
  const vertical = orientation === "vertical";

  return (
    <div
      aria-hidden
      className={cn("absolute z-10", vertical ? "top-0 h-full" : "left-0 w-full")}
      style={{
        right: vertical ? EDGE_INSET : undefined,
        bottom: vertical ? undefined : EDGE_INSET,
        width: vertical ? THUMB_THICKNESS_ACTIVE : undefined,
        height: vertical ? undefined : THUMB_THICKNESS_ACTIVE,
        pointerEvents: "none",
      }}
    >
      <div
        onPointerDown={onThumbPointerDown}
        className={cn(
          "absolute rounded-full bg-foreground",
          vertical ? "right-0" : "bottom-0",
          !dragging && "transition-[opacity,width,height] duration-200 ease-out",
        )}
        style={{
          ...(vertical
            ? {
                top: `${offsetRatio * (1 - sizeRatio) * 100}%`,
                height: `${sizeRatio * 100}%`,
                width: thickness,
                minHeight: 24,
              }
            : {
                left: `${offsetRatio * (1 - sizeRatio) * 100}%`,
                width: `${sizeRatio * 100}%`,
                height: thickness,
                minWidth: 24,
              }),
          opacity: shown ? ACTIVE_OPACITY : IDLE_OPACITY,
          pointerEvents: "auto",
          cursor: "pointer",
          touchAction: "none",
        }}
      />
    </div>
  );
}
