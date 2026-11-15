"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * "Full layout, then shrink": while `pending`, a container renders skeletons
 * for everything that might be there; when the data lands and empty sections
 * drop out, its height animates from the skeleton's height down to the real
 * one instead of snapping. Put `outerRef` on the box that should animate and
 * `innerRef` on its only child.
 */
export function useShrinkOnLoad<O extends HTMLElement = HTMLDivElement, I extends HTMLElement = HTMLDivElement>(
  pending: boolean,
) {
  const outerRef = useRef<O>(null);
  const innerRef = useRef<I>(null);
  const lastHeight = useRef(0);
  const wasPending = useRef(pending);

  // While pending, remember how tall the skeleton layout is.
  useLayoutEffect(() => {
    if (pending && outerRef.current) lastHeight.current = outerRef.current.offsetHeight;
  });

  useLayoutEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const from = lastHeight.current;
    const to = inner.offsetHeight;
    if (Math.abs(from - to) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    outer.style.overflow = "hidden";
    outer.style.height = `${from}px`;
    void outer.offsetHeight;
    outer.style.transition = "height var(--dur-3) var(--ease-out-quart)";
    outer.style.height = `${to}px`;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      outer.style.height = "";
      outer.style.overflow = "";
      outer.style.transition = "";
      outer.removeEventListener("transitionend", done);
    };
    outer.addEventListener("transitionend", done);
    const t = window.setTimeout(done, 500);
    return () => {
      window.clearTimeout(t);
      done();
    };
  }, [pending]);

  return { outerRef, innerRef };
}
