import { flushSync } from "react-dom";

const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const DURATION_MS = 320;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function snapshotRects(root: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>("[data-app-id]").forEach((el) => {
    const id = el.dataset.appId;
    if (id) map.set(id, el.getBoundingClientRect());
  });
  return map;
}

function playFlip(
  root: HTMLElement,
  first: Map<string, DOMRect>,
  duration: number,
  emphasizeId?: string,
) {
  root.querySelectorAll<HTMLElement>("[data-app-id]").forEach((el) => {
    const id = el.dataset.appId;
    if (!id) return;
    const prev = first.get(id);
    if (!prev) return;
    const next = el.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    const isMoved = id === emphasizeId;
    if (isMoved) {
      el.style.zIndex = "20";
      el.style.position = "relative";
    }

    // Invert then play to identity so the card appears to glide from its
    // previous list slot into the new one (and siblings reflow with it).
    const anim = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: isMoved ? duration : Math.round(duration * 0.85), easing: EASING, fill: "none" },
    );

    if (isMoved) {
      void anim.finished.then(() => {
        el.style.zIndex = "";
        el.style.position = "";
      }).catch(() => {
        el.style.zIndex = "";
        el.style.position = "";
      });
    }
  });
}

/** FLIP-animate list cards tagged with `data-app-id` after a synchronous layout update. */
export function flipMove(
  root: HTMLElement | null,
  update: () => void,
  options?: { duration?: number; emphasizeId?: string },
) {
  if (!root || prefersReducedMotion()) {
    update();
    return;
  }
  const first = snapshotRects(root);
  flushSync(update);
  playFlip(root, first, options?.duration ?? DURATION_MS, options?.emphasizeId);
}
