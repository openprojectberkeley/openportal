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
      if (!r.width || !row.offsetWidth) return;
      // Rects include ancestor transforms (a dialog zooming in is at scale
      // 0.5 for its first frames), but clip-path/translate are in the row's
      // own pixels: divide the scale back out.
      const sx = r.width / row.offsetWidth;
      const sy = row.offsetHeight ? r.height / row.offsetHeight : sx;
      const jump = instant || !parked.current;
      if (jump) ind.style.transitionProperty = "none";
      if (mode === "bar") {
        ind.style.transform = `translateX(${(t.left - r.left) / sx}px) scaleX(${t.width / r.width})`;
      } else {
        const top = (t.top - r.top) / sy;
        const left = (t.left - r.left) / sx;
        const right = (r.right - t.right) / sx;
        const bottom = (r.bottom - t.bottom) / sy;
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
    // A transform settling (a dialog's zoom-in) doesn't resize anything, so
    // also re-place once the enclosing overlay's animation ends.
    const overlay = row.closest<HTMLElement>("[role=dialog], [data-radix-popper-content-wrapper]");
    // Only the overlay's OWN animation: animation/transition events bubble, so
    // without the target check every animated descendant (e.g. each fading-in
    // row of a 300-row attendance sheet) re-measured every control in the
    // dialog — thousands of forced layouts per row, freezing the page.
    const settle = (e: Event) => {
      if (e.target === overlay) place(latest.current, true);
    };
    overlay?.addEventListener("animationend", settle);
    overlay?.addEventListener("transitionend", settle);
    return () => {
      ro.disconnect();
      overlay?.removeEventListener("animationend", settle);
      overlay?.removeEventListener("transitionend", settle);
    };
  }, [place]);

  const itemRef = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      items.current[i] = el;
    },
    [],
  );

  return { rowRef, indicatorRef, itemRef };
}
