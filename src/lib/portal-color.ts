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
