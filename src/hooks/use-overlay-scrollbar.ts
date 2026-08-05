"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Orientation = "vertical" | "horizontal";

export type ScrollbarMetrics = {
  /** Whether the target can scroll along this axis (has overflow). */
  scrollable: boolean;
  /** Thumb length as a fraction (0-1) of the track. */
  sizeRatio: number;
  /** Thumb start offset as a fraction (0-1) of the track. */
  offsetRatio: number;
};

const IDLE_DELAY = 800;

function isWindow(target: Window | HTMLElement): target is Window {
  return target === (target as Window).window;
}

/**
 * Drives a custom overlay scrollbar for either the window or an element.
 *
 * Returns the current thumb geometry, an `active` flag (true while scrolling,
 * hovering, or dragging — used to brighten the thumb), and a pointerdown handler
 * to make the thumb draggable. Native scrollbars are hidden globally in
 * globals.css; this only computes/drives the visual thumb.
 */
export function useOverlayScrollbar({
  target,
  orientation,
}: {
  target: Window | HTMLElement | null;
  orientation: Orientation;
}) {
  const [metrics, setMetrics] = useState<ScrollbarMetrics>({
    scrollable: false,
    sizeRatio: 0,
    offsetRatio: 0,
  });
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragState = useRef<{ startPointer: number; startScroll: number; travel: number } | null>(
    null,
  );

  // Read the scroll geometry off the target for the current axis.
  const readMetrics = useCallback((): ScrollbarMetrics => {
    if (!target) return { scrollable: false, sizeRatio: 0, offsetRatio: 0 };

    let client: number, scroll: number, pos: number;
    if (isWindow(target)) {
      const el = document.documentElement;
      if (orientation === "vertical") {
        client = target.innerHeight;
        scroll = el.scrollHeight;
        pos = target.scrollY;
      } else {
        client = target.innerWidth;
        scroll = el.scrollWidth;
        pos = target.scrollX;
      }
    } else {
      if (orientation === "vertical") {
        client = target.clientHeight;
        scroll = target.scrollHeight;
        pos = target.scrollTop;
      } else {
        client = target.clientWidth;
        scroll = target.scrollWidth;
        pos = target.scrollLeft;
      }
    }

    // Treat sub-pixel overflow (rounding) as not scrollable.
    if (scroll - client <= 1 || scroll <= 0) {
      return { scrollable: false, sizeRatio: 0, offsetRatio: 0 };
    }
    const sizeRatio = Math.min(1, client / scroll);
    const offsetRatio = pos / (scroll - client);
    return { scrollable: true, sizeRatio, offsetRatio: Math.max(0, Math.min(1, offsetRatio)) };
  }, [target, orientation]);

  const recompute = useCallback(() => {
    setMetrics(readMetrics());
  }, [readMetrics]);

  const wake = useCallback(() => {
    setActive(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_DELAY);
  }, []);

  // Wire up scroll / resize / content-mutation observers.
  useEffect(() => {
    if (!target) return;
    const scrollEl: EventTarget = target;

    const onScroll = () => {
      recompute();
      wake();
    };
    const onResize = () => recompute();

    recompute();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    // Track content-size changes (rows loading, layout shifts).
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    const observed = isWindow(target) ? document.documentElement : target;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => recompute());
      ro.observe(observed);
    }
    mo = new MutationObserver(() => recompute());
    mo.observe(observed, { childList: true, subtree: true, characterData: true });

    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      mo?.disconnect();
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [target, recompute, wake]);

  // Drag the thumb to scroll. Maps pointer travel along the track to scroll
  // position using the same ratios the thumb is rendered with.
  const onThumbPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const getPos = () =>
        isWindow(target)
          ? orientation === "vertical"
            ? target.scrollY
            : target.scrollX
          : orientation === "vertical"
            ? target.scrollTop
            : target.scrollLeft;

      // Measure the thumb's actual travel distance (track length − thumb length)
      // from the DOM so dragging tracks the cursor 1:1, regardless of how the
      // track is sized (e.g. the window scrollbar's header-offset track).
      const thumb = e.currentTarget as HTMLElement;
      const trackEl = thumb.parentElement;
      const thumbRect = thumb.getBoundingClientRect();
      const trackRect = trackEl?.getBoundingClientRect();
      const travel =
        trackRect
          ? orientation === "vertical"
            ? trackRect.height - thumbRect.height
            : trackRect.width - thumbRect.width
          : 0;

      dragState.current = {
        startPointer: orientation === "vertical" ? e.clientY : e.clientX,
        startScroll: getPos(),
        travel,
      };
      setDragging(true);
      wake();

      const onMove = (ev: PointerEvent) => {
        const st = dragState.current;
        if (!st) return;
        // Map pointer travel to scroll using the thumb's real travel distance:
        // moving the pointer across the full travel scrolls the full range.
        let client: number, scroll: number;
        if (isWindow(target)) {
          client = orientation === "vertical" ? target.innerHeight : target.innerWidth;
          scroll =
            orientation === "vertical"
              ? document.documentElement.scrollHeight
              : document.documentElement.scrollWidth;
        } else {
          client = orientation === "vertical" ? target.clientHeight : target.clientWidth;
          scroll = orientation === "vertical" ? target.scrollHeight : target.scrollWidth;
        }
        const range = scroll - client;
        if (range <= 0 || st.travel <= 0) return;
        const pointer = orientation === "vertical" ? ev.clientY : ev.clientX;
        const deltaPointer = pointer - st.startPointer;
        const next = st.startScroll + (deltaPointer * range) / st.travel;

        if (isWindow(target)) {
          target.scrollTo(
            orientation === "vertical"
              ? { top: next, behavior: "auto" }
              : { left: next, behavior: "auto" },
          );
        } else if (orientation === "vertical") {
          target.scrollTop = next;
        } else {
          target.scrollLeft = next;
        }
        wake();
      };

      const onUp = (ev: PointerEvent) => {
        dragState.current = null;
        setDragging(false);
        (e.target as HTMLElement).releasePointerCapture?.(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [target, orientation, wake],
  );

  return {
    ...metrics,
    active: active || dragging,
    dragging,
    onThumbPointerDown,
  };
}
