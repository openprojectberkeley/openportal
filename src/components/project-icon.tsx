import { readableTextColor } from "@/lib/portal-color";

// The visual identity of a project: its uploaded icon image if it has one,
// otherwise its emoji on the project's accent color, otherwise nothing.
// Shared by the applicant application page and the exec draft board.
export type ProjectIconData = {
  icon?: string | null;
  icon_url?: string | null;
  color?: string | null;
};

export function ProjectIcon({
  project,
  className = "h-8 w-8",
  onAccent = false,
}: {
  project: ProjectIconData;
  className?: string;
  /**
   * Set when the icon sits on a surface already painted in the project's own
   * accent. Tiling the emoji in that same accent would make it vanish, so it
   * becomes a translucent scrim of the surface's readable foreground instead.
   */
  onAccent?: boolean;
}) {
  const fg = project.color ? readableTextColor(project.color) : undefined;
  const tile = onAccent
    ? fg && `color-mix(in srgb, ${fg} 18%, transparent)`
    : project.color || undefined;
  if (project.icon_url) {
    return (
      // No backing colour: uploaded icons are usually transparent PNGs, so a
      // tile would box them in and hide the surface behind them.
      <span
        className={`${className} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={project.icon_url} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  if (project.icon) {
    return (
      <span
        className={`${className} flex flex-shrink-0 items-center justify-center rounded-lg text-lg bg-foreground/5`}
        style={{ backgroundColor: tile || undefined, color: fg }}
      >
        {project.icon}
      </span>
    );
  }
  return null;
}
