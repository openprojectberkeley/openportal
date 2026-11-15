import type React from "react";

// Motion tokens for code that animates from JS (the Web Animations API in
// lib/flip-move.ts). The same values live as CSS custom properties in
// app/globals.css (--dur-*, --ease-*) and as Tailwind utilities
// (`duration-2`, `ease-out-quart`, ...) via tailwind.config.ts. Keep the three
// in step: a JS-driven glide and a CSS-driven one should feel like one system.

export const DUR = {
  /** Instant tier: common hovers and selections (the Tailwind default). */
  0: 100,
  /** Micro feedback: button press, tooltip, quick fades. */
  1: 120,
  /** Dropdowns, popovers, small surfaces, hover swipes. */
  2: 180,
  /** Dialogs, sheets, medium surfaces. */
  3: 240,
  /** Upper bound for most UI. */
  4: 300,
  /** Large surfaces, steep early curves only. */
  5: 500,
} as const;

export const EASE = {
  outQuad: "cubic-bezier(.25, .46, .45, .94)",
  outCubic: "cubic-bezier(.215, .61, .355, 1)",
  outQuart: "cubic-bezier(.165, .84, .44, 1)",
  outExpo: "cubic-bezier(.19, 1, .22, 1)",
  inOutCubic: "cubic-bezier(.645, .045, .355, 1)",
  inOutQuart: "cubic-bezier(.77, 0, .175, 1)",
} as const;

/**
 * Glide between list slots / view-transition morphs. Slightly longer than the
 * product-UI ceiling because the element travels a long way across the page
 * and the expo curve front-loads the movement.
 */
export const GLIDE = { duration: 320, easing: EASE.outExpo } as const;

/**
 * Page-entry stagger for large collections (portal grid, rosters, standings).
 * Pair with `animate-fade-in-up` on each item. The delay caps at 12 steps, so a
 * 200-row list finishes its entry in ~400ms instead of crawling; items past the
 * cap arrive together. Only plays on mount (and for newly inserted keys), never
 * on re-render, so optimistic edits don't replay it.
 */
export const STAGGER_STEP_MS = 30;
export function staggerStyle(index: number): React.CSSProperties {
  return { animationDelay: `${Math.min(index, 12) * STAGGER_STEP_MS}ms` };
}
