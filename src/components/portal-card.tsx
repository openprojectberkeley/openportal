"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardCheck, Cog, MoreHorizontal, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { accentTint, hoverForeground, readableTextColor, DEFAULT_ACCENT } from "@/lib/portal-color";
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
        className="group rim-card relative flex h-full flex-col overflow-hidden border rounded-xl bg-muted p-5 hover:shadow-md has-[[data-state=open]]:shadow-md"
        style={{ "--hover-fg": hoverForeground(color) } as React.CSSProperties}
      >
        {/* Full-card click target (a button can't nest in an <a>, so the link is
            an overlay and the controls sit above it). */}
        <Link href={`/portals/${portal.id}`} aria-label={`Open ${name}`} className="absolute inset-0 z-0" />
        {/* Accent swipe: the chosen color wipes in from left to right on hover.
            At rest it stays revealed as a thin strip down the left edge, so the
            card carries its accent without hover and the swipe reads as that
            strip widening. Clipped rather than scaled so the strip keeps a fixed
            width at any card size. No transition: the most-hovered thing on the
            dashboard responds instantly (DESIGN.md, Motion). */}
        <div
          className="absolute inset-0 z-0 pointer-events-none [clip-path:inset(0_calc(100%_-_4px)_0_0)] group-hover:[clip-path:inset(0)]"
          style={{ backgroundColor: color || DEFAULT_ACCENT }}
          aria-hidden
        />

        <div className="relative z-10 pointer-events-none flex flex-1 flex-col gap-3 group-hover:text-[var(--hover-fg)]">
          <div className="flex items-center gap-3">
            {iconUrl ? (
              // No backing colour: uploaded icons are usually transparent PNGs,
              // so a tile would box them in and hide the accent swipe behind.
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={iconUrl} alt="" className="h-full w-full object-contain" />
              </span>
            ) : icon ? (
              <span
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-2xl bg-foreground/5"
                style={{ backgroundColor: color || undefined, color: color ? readableTextColor(color) : undefined }}
              >
                {icon}
              </span>
            ) : (
              // Default mark: tint the tile with the accent and draw the P in the
              // full accent color (currentColor) so it reads as the portal's color.
              <span
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-foreground/5"
                style={{ backgroundColor: color ? accentTint(color) : undefined, color: color || undefined }}
              >
                <PortalDefaultIcon className="h-7 w-7" />
              </span>
            )}
            <div className="flex items-center gap-2 min-w-0 flex-wrap pr-8">
              <span className="text-base font-semibold tracking-tight truncate">{name}</span>
              <AdminCrown active={portal.is_admin} owner={portal.is_owner} hoverInheritFg />
            </div>
          </div>
          {/* Always rendered and always two lines tall (empty or not), so every
              card in the grid is the same size. */}
          <p className="min-h-[2lh] text-sm text-muted-foreground group-hover:text-[var(--hover-fg)] group-hover:opacity-70 line-clamp-2">
            {description}
          </p>
        </div>

        {/* Card actions live in one overflow menu, revealed on hover/focus, so
            a wall of portals isn't a wall of icon rows. Always visible on
            touch screens, which have no hover to reveal it. */}
        <div className="absolute top-3 right-3 z-20">
          {/* modal={false}: every item opens a Dialog, and a modal menu handing
              off to a modal Dialog leaves `pointer-events: none` stuck on
              <body> after the Dialog closes (both lock the body; the restores
              race). The Dialog provides the modality here. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${name} actions`}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-[var(--hover-fg)] hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => setMembersOpen(true)}>
                <Users /> Members
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAttendanceOpen(true)}>
                <ClipboardCheck /> Attendance
              </DropdownMenuItem>
              {portal.is_admin && (
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <Cog /> Settings
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
