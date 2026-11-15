import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The way back up a level, mirroring the forward links ("Calendar →" on the
 * dashboard): the destination's name, not "Back", with an arrow that nudges
 * toward where it goes on hover (instant tier).
 */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex w-fit items-center gap-1 text-sm font-semibold tracking-tight transition-colors hover:text-muted-foreground",
        className,
      )}
    >
      <ArrowLeft
        size={14}
        aria-hidden
        className="transition-transform duration-instant ease-out-quart group-hover:-translate-x-0.5"
      />
      {label}
    </Link>
  );
}
