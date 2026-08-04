// A readable tint of a portal's accent color, mixed toward the current theme
// background so it stays legible in light and dark mode. Returns a CSS
// `color-mix(...)` string for an inline `style`, or undefined when there's no
// color set. Higher `pct` = more saturated.
export function accentTint(color: string | null | undefined, pct = 14): string | undefined {
  if (!color) return undefined;
  return `color-mix(in srgb, ${color} ${pct}%, hsl(var(--background)))`;
}
