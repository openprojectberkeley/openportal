import { Github, Linkedin } from "lucide-react";
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

/** A LinkedIn/GitHub link shown as its icon and the handle. */
export function SocialLink({ kind, value, className }: { kind: Kind; value: string | null | undefined; className?: string }) {
  const parsed = parseSocial(kind, value);
  if (!parsed) return null;
  const Icon = kind === "linkedin" ? Linkedin : Github;
  return (
    <a
      href={parsed.href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${kind === "linkedin" ? "LinkedIn" : "GitHub"}: ${parsed.handle}`}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-foreground underline-offset-2 hover:underline",
        className,
      )}
    >
      <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{parsed.handle}</span>
    </a>
  );
}
