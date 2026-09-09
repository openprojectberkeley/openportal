import { flushSync } from "react-dom";
import { prefersReducedMotion } from "@/lib/flip-move";

// Elements on both sides of the update that carry the same `view-transition-name`
// are morphed into each other by the browser -- position and size -- which is how
// a staged draft pick glides up into the Confirmed list even though the two are
// different shapes. flushSync is what makes React commit inside the transition's
// capture window; without it the browser snapshots the old DOM twice.
//
// Shaped like flipMove (lib/flip-move.ts): same reduced-motion escape hatch, and
// it degrades to a plain update where the API is missing (Firefox) rather than
// gating the state change on it.
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

export function withViewTransition(update: () => void) {
  const doc = document as DocumentWithViewTransition;
  if (typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}
