"use client";

import { DEFAULT_ACCENT, readableTextColor } from "@/lib/portal-color";
import { PortalDefaultIcon } from "@/components/portal-default-icon";

/**
 * A family's identity at a given size: uploaded image, else emoji, else the
 * default mark — the same three-way fallback portal and project cards use.
 *
 * The tile is painted with the family's accent and its glyph takes whichever of
 * black/white reads against it, so a family is recognizable by color alone in
 * the standings, the podium and the admin list. Sized in px rather than by
 * Tailwind class because the same component renders at 16px in the dashboard
 * card and 56px on the podium.
 */
export function FamilyMark({
  icon,
  iconUrl,
  color,
  name,
  size,
  onAccent = false,
  className = "",
}: {
  icon: string | null;
  iconUrl: string | null;
  color: string | null;
  name: string;
  size: number;
  /**
   * Set when the mark sits on a surface already painted in its own accent (the
   * scoreboard cards). Painting the tile that same accent would make it vanish,
   * so it becomes a translucent scrim of whichever of black/white reads against
   * the accent — the same colour the surrounding text uses.
   */
  onAccent?: boolean;
  className?: string;
}) {
  const accent = color || DEFAULT_ACCENT;
  const fg = readableTextColor(color);

  return (
    <span
      className={`flex items-center justify-center overflow-hidden flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.22)),
        // An uploaded icon gets no tile at all: these are usually transparent
        // PNGs, and a backing colour would box them in and hide whatever the
        // surface behind is doing (the card's accent gradient). Emoji and the
        // default mark still need their tile to read as a mark.
        backgroundColor: iconUrl
          ? undefined
          : onAccent
            ? `color-mix(in srgb, ${fg} 18%, transparent)`
            : accent,
        color: fg,
      }}
      aria-hidden
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" className="h-full w-full object-contain" />
      ) : icon ? (
        <span style={{ fontSize: Math.round(size * 0.55), lineHeight: 1 }}>{icon}</span>
      ) : (
        <PortalDefaultIcon style={{ height: size * 0.6, width: "auto" }} />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
