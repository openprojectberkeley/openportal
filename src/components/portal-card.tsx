"use client";

import Link from "next/link";
import { Lock, type LucideIcon } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";

export type PortalCardProps = {
  name: string;
  description: string;
  href: string;
  icon?: LucideIcon;
  /**
   * Access levels (e.g. "board", "exec") allowed to open this portal.
   * Empty or omitted means every active member can access it.
   */
  requiredAccessLevels?: string[];
};

export function PortalCard({ name, description, href, icon: Icon, requiredAccessLevels }: PortalCardProps) {
  const { accessLevels } = useRoleSim();

  const hasAccess =
    !requiredAccessLevels ||
    requiredAccessLevels.length === 0 ||
    requiredAccessLevels.some((level) => accessLevels.includes(level));

  const content = (
    <div
      className={`border rounded-xl p-5 flex flex-col gap-3 bg-background transition-shadow h-full ${
        hasAccess ? "hover:shadow-sm" : "opacity-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="h-9 w-9 rounded-lg bg-foreground/10 flex items-center justify-center flex-shrink-0">
              <Icon size={18} />
            </div>
          )}
          <span className="font-semibold text-sm truncate">{name}</span>
        </div>
        {!hasAccess && (
          <div className="flex items-center gap-1 text-muted-foreground flex-shrink-0" title="Restricted access">
            <Lock size={14} />
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );

  if (!hasAccess) {
    return (
      <div aria-disabled="true" className="cursor-not-allowed">
        {content}
      </div>
    );
  }

  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}
