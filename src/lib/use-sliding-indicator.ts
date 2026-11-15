"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * One indicator that slides between the items of a row: the selected pill in
 * a segmented control, the underline in a tab strip. Same mechanics as the
 * header's NavTabs underline (nav-tab.tsx): measure the row and the target
 * item, write the result straight to the indicator's style (no React state per
 * frame), snap on first paint, re-measure on resize without animating.
 *
 * Two shapes:
 * - "bar":  a full-width 2px bar moved with translateX + scaleX (an underline).
 * - "pill": a full-size layer clipped with `clip-path: inset(... round r)` to
 *           the target's box, so the corners never distort the way scaleX
 *           would, and nothing animates width or left.
 */
export function useSlidingIndicator(index: number | null, mode: "bar" | "pill", radius = 6) {
  const rowRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const items = useRef<(HTMLElement | null)[]>([]);
  const parked = useRef(false);
  const latest = useRef(index);

  const place = useCallback(
    (i: number | null, instant: boolean) => {
      const row = rowRef.current;
      const ind = indicatorRef.current;
      if (!row || !ind) return;
      const item = i === null ? null : items.current[i];
      if (!item) {
        ind.style.opacity = "0";
        parked.current = false;
        return;
      }
      const r = row.getBoundingClientRect();
      const t = item.getBoundingClientRect();
      if (!r.width) return;
      const jump = instant || !parked.current;
      if (jump) ind.style.transitionProperty = "none";
      if (mode === "bar") {
        ind.style.transform = `translateX(${t.left - r.left}px) scaleX(${t.width / r.width})`;
      } else {
        const top = t.top - r.top;
        const left = t.left - r.left;
        const right = r.right - t.right;
        const bottom = r.bottom - t.bottom;
        ind.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
      }
      if (jump) {
        void ind.offsetWidth; // commit the snap before restoring the transition
        ind.style.transitionProperty = "";
      }
      ind.style.opacity = "1";
      parked.current = true;
    },
    [mode, radius],
  );

  useLayoutEffect(() => {
    latest.current = index;
    place(index, false);
  }, [index, place]);

  // Fonts swapping in, labels wrapping, a dialog opening: re-measure, no glide.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => place(latest.current, true));
    ro.observe(row);
    for (const el of items.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [place]);

  const itemRef = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      items.current[i] = el;
    },
    [],
  );

  return { rowRef, indicatorRef, itemRef };
}
