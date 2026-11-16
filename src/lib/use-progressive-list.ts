"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

/** Rows of `rowPx` that fill most of the window, plus a couple spare. */
export function firstScreenRows(rowPx: number): number {
  return typeof window === "undefined" ? 24 : Math.ceil((window.innerHeight * 0.85) / rowPx) + 2;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return p;
  }
  return null;
}

/**
 * Mount a long list a block at a time, as the user scrolls: the first screen
 * up front, then `step` more each time the sentinel (rendered after the last
 * row while `hasMore`) scrolls into view. Callers render `pendingRows`
 * skeleton rows after the real ones, each carrying `sentinelRef`: the
 * list never ends early under a fast scroll, and what's still coming reads as
 * loading. A 300-person roster never mounts rows nobody scrolled to.
 *
 * Starts over at one screen whenever `resetKey` changes: pass what makes it a
 * different list (dialog opened, search text, a filter), not the array itself,
 * so an edit to one row (a toggle, a removal) never collapses a scrolled list.
 *
 * Ctrl+F only finds mounted rows; lists that use this have their own search.
 */
export function useProgressiveList<T>(
  items: readonly T[],
  {
    resetKey,
    rowPx = 32,
    step = 40,
    prefetchPx = 0,
    skeletonRows = 12,
  }: { resetKey?: unknown; rowPx?: number; step?: number; prefetchPx?: number; skeletonRows?: number } = {},
) {
  const [count, setCount] = useState(() => firstScreenRows(rowPx));
  // How many rows were in the first screen of the current list, for callers
  // that animate only those (rows mounted later, below the fold, just appear).
  const [initialCount, setInitialCount] = useState(count);
  // The scroll container, once a sentinel has found it. A new list also goes
  // back to the top: left scrolled down, the sentinel would sit in view and
  // load block after block, as if nothing were progressive at all.
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const n = firstScreenRows(rowPx);
    setCount(n);
    setInitialCount(n);
    rootRef.current?.scrollTo({ top: 0 });
  }, [resetKey, rowPx]);

  const hasMore = count < items.length;
  // Every skeleton row is a sentinel, not just the first: a fast scroll or a
  // jump to the bottom can skip straight past the first one, and then nothing
  // would ever load. (A React 19 ref callback's cleanup drops a row as it goes.)
  const sentinels = useRef(new Set<HTMLElement>());
  const [sentinelsVersion, setSentinelsVersion] = useState(0);
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    sentinels.current.add(node);
    setSentinelsVersion((v) => v + 1);
    return () => {
      sentinels.current.delete(node);
      setSentinelsVersion((v) => v + 1);
    };
  }, []);

  // Re-armed after every block, so skeletons still in view (a fast scroll, a
  // tall window) load the next block straight away.
  const loading = useRef(false);
  useEffect(() => {
    const els = [...sentinels.current];
    if (els.length === 0 || !hasMore) return;
    loading.current = false;
    rootRef.current = scrollParent(els[0]);
    const io = new IntersectionObserver(
      (entries) => {
        if (loading.current || !entries.some((e) => e.isIntersecting)) return;
        loading.current = true;
        startTransition(() => setCount((c) => c + step));
      },
      { root: rootRef.current, rootMargin: `0px 0px ${prefetchPx}px 0px` },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [sentinelsVersion, hasMore, count, step, prefetchPx]);

  return {
    visible: items.slice(0, count),
    hasMore,
    /** Skeleton rows to render after the real ones: what's left, capped. */
    pendingRows: Math.min(Math.max(items.length - count, 0), skeletonRows),
    sentinelRef,
    initialCount,
  };
}
