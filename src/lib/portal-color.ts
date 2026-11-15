import type { CSSProperties } from "react";

// Fallback accent for portals/projects with no color set: a soft, faintly cool
// light gray so a colorless card still reads as intentional rather than a flat
// mid gray. Light in both themes, so `readableTextColor` picks dark text over it.
export const DEFAULT_ACCENT = "#c2c5cf";

// A readable tint of a portal's accent color, mixed toward the current theme
// background so it stays legible in light and dark mode. Returns a CSS
// `color-mix(...)` string for an inline `style`, or undefined when there's no
// color set. Higher `pct` = more saturated.
export function accentTint(
  color: string | null | undefined,
  pct = 14,
  base = "hsl(var(--background))",
): string | undefined {
  if (!color) return undefined;
  return `color-mix(in srgb, ${color} ${pct}%, ${base})`;
}

// The one edge every accent surface wears: a 1px inset ring in the accent at
// low alpha. It replaces the diagonal white/black sheen these surfaces used to
// carry. A tint mixed toward a near-black dark-mode background goes murky at
// its edges; a hairline of the colour itself is what keeps it crisp, and it
// reads the same on every accent in both themes without a gradient.
//
// A box-shadow rather than a border so it costs no layout and composes with a
// caller's own `border` class (which stays the theme's neutral border).
export function accentRing(color: string | null | undefined, pct = 14): string | undefined {
  if (!color) return undefined;
  return `inset 0 0 0 1px color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// Background for a card painted with a project's accent. Inline rather than a
// Tailwind class because the color is per-project data, not a theme token.
// Flat tint plus the accent ring: no gradient, so the colour reads as the
// colour, not as a lit plastic tile.
//
// Deliberately sets no border colour: a saturated accent outline around a dark
// tinted fill reads as a warning box and fights every other card on the page.
// Callers keep their own `border` class, which resolves to the theme's own
// subtle border, so the accent shows up as fill alone.
//
// The tint mixes toward --muted, not --background, so an accent-painted tile
// sits at the same brightness as the plain `bg-muted` cards it shares a page
// with. Mixed toward --background it came out markedly darker than them in dark
// mode (3.9% vs 14.9% lightness), which read as a different kind of surface
// rather than the same card wearing a colour. In light mode the two bases are
// 94% and 97%, so the base swap is a dark-mode fix.
//
// Everything whose job is to SHOUT a colour uses accentFill instead, so what is
// left here is small, dense, text-heavy surfaces — applicant cards, a family
// badge on a project row. Those want the accent clearly present rather than
// barely there, hence 22%: enough that the colour is the first thing you read
// off the card, while ordinary foreground text still sits on it legibly.
// Full-strength accent fill: the raw colour, flat, with text set to whichever
// of black/white survives on top. This is the loud sibling of accentStyle's tint — for surfaces whose
// whole job is to carry a project's or family's colour (the scoreboard cards,
// the draft board's column heads).
//
// It sets `color`, so descendants inherit a legible foreground. Anything inside
// that pins its own colour — a semantic badge, muted meta text — keeps it, and
// needs checking against the fill before a surface is switched over.
export function accentFill(accent: string | null | undefined): CSSProperties | undefined {
  if (!accent) return undefined;
  return {
    backgroundColor: accent,
    color: readableTextColor(accent),
  };
}

export function accentStyle(accent: string | null | undefined, pct = 22): CSSProperties | undefined {
  return accent
    ? {
        backgroundColor: accentTint(accent, pct, "hsl(var(--muted))"),
        boxShadow: accentRing(accent),
      }
    : undefined;
}

// WCAG relative luminance of a hex colour (0 black … 1 white), or null when it
// isn't a parseable hex.
export function accentLuminance(color: string | null | undefined): number | null {
  if (!color) return null;
  const hex = color.replace("#", "").trim();
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

// A data mark (score bar, chart segment) in an accent that may be too dark to
// see: a navy portal colour on dark mode's near-black track all but vanishes.
// Below the threshold the colour is pulled 35% toward the theme foreground,
// which lifts it in dark mode and darkens it (harmlessly) in light mode, so the
// mark stays the same hue family and stays visible in both.
/**
 * An accent as readable TEXT on the page (labels like an event's category or
 * portal name). Mixing 30% toward the theme foreground darkens light colours
 * in light mode and lightens dark ones in dark mode, so amber/green on a light
 * page and navy on a dark one both stay legible. Not for text laid over the
 * accent itself; that's readableTextColor.
 */
export function readableAccentText(color: string): string {
  return `color-mix(in srgb, ${color} 70%, hsl(var(--foreground)))`;
}

export function visibleMarkColor(color: string): string {
  const l = accentLuminance(color);
  return l !== null && l < 0.06
    ? `color-mix(in srgb, ${color} 65%, hsl(var(--foreground)))`
    : color;
}

// Black or white — whichever has the higher contrast against `color` — so text
// laid over the accent stays legible. Uses the WCAG relative-luminance crossover
// (~0.179); falls back to white for missing/invalid colors.
export function readableTextColor(color: string | null | undefined): string {
  const luminance = accentLuminance(color);
  if (luminance === null) return "#ffffff";
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

// WCAG contrast ratio (1–21) between `color` and the text readableTextColor
// picks for it. Null for missing/invalid colors. Never below ~4.58 (the
// black/white crossover), so useful thresholds sit above the AA 4.5.
export function readableContrast(color: string | null | undefined): number | null {
  const l = accentLuminance(color);
  if (l === null) return null;
  return l > 0.179 ? (l + 0.05) / 0.05 : 1.05 / (l + 0.05);
}

// Text/icon color to lay over a card's hover swipe — the higher-contrast of
// black/white against whichever accent backs the swipe. With no color the swipe
// falls back to `DEFAULT_ACCENT` (a light gray in both themes), so this resolves
// to dark text that stays legible over it.
export function hoverForeground(color: string | null | undefined): string {
  return readableTextColor(color || DEFAULT_ACCENT);
}
