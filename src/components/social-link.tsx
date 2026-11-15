import { cn } from "@/lib/utils";

type Kind = "linkedin" | "github";

const PATTERN: Record<Kind, RegExp> = {
  linkedin: /^(https?:\/\/)?([a-z]+\.)?linkedin\.com\/(in\/)?/i,
  github: /^(https?:\/\/)?(www\.)?github\.com\//i,
};
const BASE: Record<Kind, string> = {
  linkedin: "https://www.linkedin.com/in/",
  github: "https://github.com/",
};

/**
 * Stored LinkedIn/GitHub values may be full URLs, "linkedin.com/in/…" or bare
 * handles. Returns the handle and a clickable URL, or null for an empty value.
 */
export function parseSocial(kind: Kind, raw: string | null | undefined): { handle: string; href: string } | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const stripped = v.replace(PATTERN[kind], "").replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^@/, "");
  if (PATTERN[kind].test(v) || !/[./]/.test(stripped)) {
    return { handle: stripped, href: `${BASE[kind]}${stripped}` };
  }
  // Something else (another site): link it as typed.
  return { handle: v.replace(/^https?:\/\//, ""), href: /^https?:\/\//.test(v) ? v : `https://${v}` };
}

// Brand marks drawn in currentColor (one colour, following the text: white in
// dark mode, near-black in light).
function GithubMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 248" fill="currentColor" className={className} aria-hidden>
      <g transform="matrix(2.666667,0,0,2.666667,-43.2,-45.333333)">
        <path d="M56.794,84.969C44.419,83.469 35.7,74.562 35.7,63.031C35.7,58.344 37.388,53.281 40.2,49.906C38.981,46.812 39.169,40.25 40.575,37.531C44.325,37.062 49.388,39.031 52.388,41.75C55.95,40.625 59.7,40.062 64.294,40.062C68.888,40.062 72.638,40.625 76.013,41.656C78.919,39.031 84.075,37.062 87.825,37.531C89.138,40.062 89.325,46.625 88.106,49.812C91.106,53.375 92.7,58.156 92.7,63.031C92.7,74.562 83.981,83.281 71.419,84.875C74.606,86.938 76.763,91.438 76.763,96.594L76.763,106.344C76.763,109.156 79.106,110.75 81.919,109.625C98.888,103.156 112.2,86.188 112.2,65.188C112.2,38.656 90.638,17 64.106,17C37.575,17 16.2,38.656 16.2,65.188C16.2,86 29.419,103.25 47.231,109.719C49.763,110.656 52.2,108.969 52.2,106.438L52.2,98.938C50.888,99.5 49.2,99.875 47.7,99.875C41.513,99.875 37.856,96.5 35.231,90.219C34.2,87.688 33.075,86.188 30.919,85.906C29.794,85.812 29.419,85.344 29.419,84.781C29.419,83.656 31.294,82.812 33.169,82.812C35.888,82.812 38.231,84.5 40.669,87.969C42.544,90.688 44.513,91.906 46.856,91.906C49.2,91.906 50.7,91.062 52.856,88.906C54.45,87.312 55.669,85.906 56.794,84.969Z" />
      </g>
    </svg>
  );
}

function LinkedinMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className} aria-hidden>
      <g transform="matrix(0.670157,0,0,0.670157,0,0)">
        <path d="M347.445,0L34.555,0C15.471,0 0,15.471 0,34.555L0,347.444C0,366.529 15.471,382 34.555,382L347.444,382C366.529,382 382,366.529 382,347.444L382,34.555C382,15.471 366.529,0 347.445,0ZM118.207,329.844C118.207,335.398 113.705,339.9 108.151,339.9L65.345,339.9C59.791,339.9 55.289,335.398 55.289,329.844L55.289,150.403C55.289,144.849 59.791,140.347 65.345,140.347L108.151,140.347C113.705,140.347 118.207,144.849 118.207,150.403L118.207,329.844ZM86.748,123.432C64.289,123.432 46.082,105.225 46.082,82.766C46.082,60.307 64.289,42.1 86.748,42.1C109.207,42.1 127.414,60.307 127.414,82.766C127.414,105.225 109.208,123.432 86.748,123.432ZM341.91,330.654C341.91,335.76 337.77,339.9 332.664,339.9L286.73,339.9C281.624,339.9 277.484,335.76 277.484,330.654L277.484,246.486C277.484,233.93 281.167,191.465 244.671,191.465C216.362,191.465 210.62,220.531 209.467,233.575L209.467,330.654C209.467,335.76 205.328,339.9 200.221,339.9L155.795,339.9C150.689,339.9 146.549,335.76 146.549,330.654L146.549,149.593C146.549,144.487 150.689,140.347 155.795,140.347L200.221,140.347C205.327,140.347 209.467,144.487 209.467,149.593L209.467,165.248C219.964,149.495 235.564,137.336 268.779,137.336C342.331,137.336 341.91,206.052 341.91,243.808L341.91,330.654Z" />
      </g>
    </svg>
  );
}

/** A LinkedIn/GitHub link shown as its icon and the handle. */
export function SocialLink({ kind, value, className }: { kind: Kind; value: string | null | undefined; className?: string }) {
  const parsed = parseSocial(kind, value);
  if (!parsed) return null;
  const Icon = kind === "linkedin" ? LinkedinMark : GithubMark;
  return (
    <a
      href={parsed.href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${kind === "linkedin" ? "LinkedIn" : "GitHub"}: ${parsed.handle}`}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-brand underline-offset-2 hover:underline",
        className,
      )}
    >
      <Icon size={14} className="shrink-0 text-foreground" />
      <span className="truncate">{parsed.handle}</span>
    </a>
  );
}
