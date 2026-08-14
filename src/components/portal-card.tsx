"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardCheck, Cog, Users } from "lucide-react";
import { accentTint, readableTextColor } from "@/lib/portal-color";
import { PortalSettingsModal } from "@/components/portal-settings-modal";
import { PortalMembersModal } from "@/components/portal-members-modal";
import { PortalAttendanceModal } from "@/components/portal-attendance-modal";
import { usePortalMeta } from "@/components/portal-meta-provider";
import { AdminCrown } from "@/components/admin-crown";
import { PortalDefaultIcon } from "@/components/portal-default-icon";

export type PortalSummary = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  is_admin: boolean;
  is_owner: boolean;
};

export function PortalCard({ portal }: { portal: PortalSummary }) {
  const { overrides } = usePortalMeta();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);

  // Live values: an in-session settings save (via context) wins over the
  // originally-fetched props, so the card updates instantly with no reload.
  const o = overrides[portal.id];
  const name = o?.name ?? portal.name;
  const icon = (o ? o.icon : portal.icon) ?? "";
  const iconUrl = (o ? o.icon_url : portal.icon_url) ?? null;
  const color = (o ? o.color : portal.color) ?? "";
  const description = (o ? o.description : portal.description) ?? "";

  return (
    <>
      <div
        className="group relative overflow-hidden border rounded-xl bg-muted p-5 transition-[transform,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:shadow-sm"
        style={{ "--hover-fg": readableTextColor(color) } as React.CSSProperties}
      >
        {/* Full-card click target (a button can't nest in an <a>, so the link is
            an overlay and the controls sit above it). */}
        <Link href={`/portals/${portal.id}`} aria-label={`Open ${name}`} className="absolute inset-0 z-0" />
        {/* Accent swipe: the chosen color wipes in from left to right on hover. */}
        <div
          className="absolute inset-0 z-0 origin-left scale-x-0 group-hover:scale-x-100 pointer-events-none transition-transform duration-300 ease-out"
          style={{ backgroundColor: color || "hsl(var(--muted-foreground))" }}
          aria-hidden
        />

        <div className="relative z-10 pointer-events-none flex flex-col gap-3 group-hover:text-[var(--hover-fg)] transition-colors">
          <div className="flex items-center gap-3">
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconUrl}
                alt=""
                className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
              />
            ) : icon ? (
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xl bg-foreground/5"
                style={{ backgroundColor: color || undefined, color: color ? readableTextColor(color) : undefined }}
              >
                {icon}
              </span>
            ) : (
              // Default mark: tint the tile with the accent and draw the P in the
              // full accent color (currentColor) so it reads as the portal's color.
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-foreground/5"
                style={{ backgroundColor: color ? accentTint(color) : undefined, color: color || undefined }}
              >
                <PortalDefaultIcon className="h-6 w-6" />
              </span>
            )}
            <div className="flex items-center gap-2 min-w-0 flex-wrap pr-12">
              <span className="font-medium truncate">{name}</span>
              <AdminCrown active={portal.is_admin} owner={portal.is_owner} hoverInheritFg />
            </div>
          </div>
          {description && (
            <p className="text-sm text-muted-foreground group-hover:text-[var(--hover-fg)] group-hover:opacity-70 line-clamp-2 transition-colors">
              {description}
            </p>
          )}
        </div>

        <div className="absolute top-3 right-3 z-20 flex items-center gap-1">
          <button
            onClick={() => setMembersOpen(true)}
            aria-label="View members"
            className="text-muted-foreground group-hover:text-[var(--hover-fg)] opacity-70 hover:opacity-100 transition"
          >
            <Users size={16} />
          </button>
          <button
            onClick={() => setAttendanceOpen(true)}
            aria-label="Attendance"
            className="text-muted-foreground group-hover:text-[var(--hover-fg)] opacity-70 hover:opacity-100 transition"
          >
            <ClipboardCheck size={16} />
          </button>
          {portal.is_admin && (
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Portal settings"
              className="text-muted-foreground group-hover:text-[var(--hover-fg)] opacity-70 hover:opacity-100 transition"
            >
              <Cog size={16} />
            </button>
          )}
        </div>
      </div>

      <PortalMembersModal
        portalId={portal.id}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        canEdit={portal.is_admin}
      />

      <PortalAttendanceModal
        portalId={portal.id}
        open={attendanceOpen}
        onOpenChange={setAttendanceOpen}
        canManage={portal.is_admin}
      />

      {portal.is_admin && (
        <PortalSettingsModal
          portalId={portal.id}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initial={{ name, icon, iconUrl, color, description }}
          onMetaSaved={() => {}}
        />
      )}
    </>
  );
}
