import type { CSSProperties } from "react";

// Fallback accent for portals/projects with no color set: a soft, faintly cool
// light gray so a colorless card still reads as intentional rather than a flat
// mid gray. Light in both themes, so `readableTextColor` picks dark text over it.
export const DEFAULT_ACCENT = "#c2c5cf";

// A readable tint of a portal's accent color, mixed toward the current theme
// background so it stays legible in light and dark mode. Returns a CSS
// `color-mix(...)` string for an inline `style`, or undefined when there's no
// color set. Higher `pct` = more saturated.
export function accentTint(color: string | null | undefined, pct = 14): string | undefined {
  if (!color) return undefined;
  return `color-mix(in srgb, ${color} ${pct}%, hsl(var(--background)))`;
}

// A light diagonal sheen for a surface painted with an accent: a white lift at
// the top-left, through the untouched colour, to a shade at the bottom-right.
// Returned as a `backgroundImage` so it layers over whatever `backgroundColor`
// the caller already set — the flat tint on a card, the raw accent on a hover
// swipe — without needing to know which.
//
// Plain white/black alpha stops rather than a gradient between two color-mix()
// of the accent: that nests color-mix inside linear-gradient, which some engines
// drop outright, and it bakes the theme into the colour stops. The alphas come
// from globals.css, which the .dark block re-balances, so one gradient works on
// every accent in both themes.
//
// `strength`: "card" over a tinted surface, where the text is the theme
// foreground and the sheen can run both ways.
//
// "accent" over the RAW accent, where readableTextColor() text sits directly on
// top — that variant lifts only, never darkens. readableTextColor picks BLACK
// for nearly every accent in the picker's palette (its crossover is 0.179 and
// even #6366f1 lands at 0.185), so darkening is the direction that erodes
// contrast: indigo sits at 4.70:1 flat, and a drop of just 0.02 already pulls it
// under that. A lift costs nothing at any size — it only moves black text
// further from its background — so the sheen reads as light falling on the
// top-left corner and settles on the untouched accent, never below it.
export function accentSheen(strength: "card" | "accent" = "card", angle = "145deg"): string {
  if (strength === "accent") {
    return `linear-gradient(${angle}, rgb(255 255 255 / var(--sheen-lift-accent)) 0%, rgb(255 255 255 / 0) 100%)`;
  }
  return (
    `linear-gradient(${angle}, rgb(255 255 255 / var(--sheen-lift)) 0%,` +
    ` rgb(255 255 255 / 0) 48%, rgb(0 0 0 / var(--sheen-drop)) 100%)`
  );
}

// Border + background for a card painted with a project's accent. Inline rather
// than a Tailwind class because the color is per-project data, not a theme token.
// The sheen rides on top of the flat tint rather than replacing it, so a caller
// whose class list sets no background still has an opaque fill.
export function accentStyle(accent: string | null | undefined, pct = 14): CSSProperties | undefined {
  return accent
    ? { borderColor: accent, backgroundColor: accentTint(accent, pct), backgroundImage: accentSheen() }
    : undefined;
}

// Black or white — whichever has the higher contrast against `color` — so text
// laid over the accent stays legible. Uses the WCAG relative-luminance crossover
// (~0.179); falls back to white for missing/invalid colors.
export function readableTextColor(color: string | null | undefined): string {
  if (!color) return "#ffffff";
  const hex = color.replace("#", "").trim();
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const channel = (i: number) => {
    const s = parseInt(full.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

// Text/icon color to lay over a card's hover swipe — the higher-contrast of
// black/white against whichever accent backs the swipe. With no color the swipe
// falls back to `DEFAULT_ACCENT` (a light gray in both themes), so this resolves
// to dark text that stays legible over it.
export function hoverForeground(color: string | null | undefined): string {
  return readableTextColor(color || DEFAULT_ACCENT);
}
