import { readableTextColor } from "@/lib/portal-color";

// The visual identity of a project: its uploaded icon image if it has one,
// otherwise its emoji on the project's accent color, otherwise nothing.
// Shared by the applicant application page and the exec draft board.
export type ProjectIconData = {
  icon?: string | null;
  icon_url?: string | null;
  color?: string | null;
};

export function ProjectIcon({ project, className = "h-8 w-8" }: { project: ProjectIconData; className?: string }) {
  if (project.icon_url) {
    return (
      <span
        className={`${className} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground/5`}
        style={{ backgroundColor: project.color || undefined }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={project.icon_url} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  if (project.icon) {
    return (
      <span
        className={`${className} flex flex-shrink-0 items-center justify-center rounded-lg text-lg bg-foreground/5`}
        style={{ backgroundColor: project.color || undefined, color: project.color ? readableTextColor(project.color) : undefined }}
      >
        {project.icon}
      </span>
    );
  }
  return null;
}
