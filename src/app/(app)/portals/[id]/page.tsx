"use client";

import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Cog, Pencil, Users } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";
import { CalendarPanel } from "@/components/calendar-panel";
import { PortalDetailSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { PortalSettingsModal } from "@/components/portal-settings-modal";
import { PortalMembersModal } from "@/components/portal-members-modal";
import { PortalAttendanceModal } from "@/components/portal-attendance-modal";
import { PortalDefaultIcon } from "@/components/portal-default-icon";
import { PortalContent } from "@/components/portal-content";
import { BackLink } from "@/components/back-link";
import { PortalLinks, type PortalLinkValues } from "@/components/portal-links";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Portal = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  content: string | null;
} & PortalLinkValues;

// useParams() reads uncached route data; cacheComponents requires it to sit
// inside a Suspense boundary so the page shell can still prerender.
export default function PortalPage() {
  return (
    <Suspense fallback={<PortalDetailSkeleton />}>
      <PortalDetail />
    </Suspense>
  );
}

function PortalDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const portalId = params.id;
  const { isExec } = useRoleSim();
  const [portal, setPortal] = useState<Portal | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/login");
        return;
      }

      // RLS only returns the portal if the user is a member of it, so a missing
      // row means no access.
      const { data: portalRow } = await supabase
        .from("portals")
        .select("id, name, description, icon, icon_url, color, content, github_url, notion_url, slack_url, linear_url")
        .eq("id", portalId)
        .maybeSingle();

      if (!portalRow) {
        setNotFound(true);
        return;
      }
      setPortal(portalRow);

      // Admin of this portal: exec, an explicit admin-tier row, or an auto-admin role.
      const [{ data: memberRow }, { data: roleRows }, { data: portalRoleRows }] = await Promise.all([
        supabase
          .from("portal_members")
          .select("is_admin")
          .eq("portal_id", portalId)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("members_roles").select("role_id").eq("user_id", user.id),
        supabase.from("portal_roles").select("role_id, is_admin").eq("portal_id", portalId),
      ]);

      const myRoleIds = new Set((roleRows ?? []).map((r) => r.role_id));
      const adminByRole = (portalRoleRows ?? []).some((pr) => pr.is_admin && myRoleIds.has(pr.role_id));
      setIsAdmin(isExec || Boolean(memberRow?.is_admin) || adminByRole);
    };

    load();
  }, [router, portalId, isExec]);

  if (notFound) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-sm text-muted-foreground">
          This portal doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!portal) {
    return <PortalDetailSkeleton />;
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <BackLink href="/" label="Dashboard" />

      <div className="flex flex-col gap-2">
        {/* Edit sits on its own row above the actions, right-aligned. The row
            keeps its height while editing so the header doesn't jump. */}
        {isAdmin && (
          <div className="flex h-5 justify-end">
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {portal.icon_url ? (
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground/5"
                style={{ backgroundColor: portal.color || undefined }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={portal.icon_url} alt="" className="h-full w-full object-cover" />
              </span>
            ) : portal.icon ? (
              <span className="text-2xl leading-none">{portal.icon}</span>
            ) : (
              <PortalDefaultIcon
                className="h-8 w-8 flex-shrink-0 text-foreground"
                style={{ color: portal.color || undefined }}
              />
            )}
            {/* truncate clips at the padding box, so leading + pb leave room for
                descenders (g, j, y) instead of shaving them off. */}
            <h1 className="text-4xl font-bold tracking-tight truncate leading-[1.2] pb-1 -mb-1">{portal.name}</h1>
            <PortalLinks
              portalId={portal.id}
              links={{
                github_url: portal.github_url,
                notion_url: portal.notion_url,
                slack_url: portal.slack_url,
                linear_url: portal.linear_url,
              }}
              editing={isAdmin && editing}
              onSaved={(links) => setPortal((p) => (p ? { ...p, ...links } : p))}
            />
          </div>
          {/* Labels drop below md; the icon and tooltip carry them. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <HeaderAction icon={<Users size={15} />} label="View members" onClick={() => setMembersOpen(true)} />
            <HeaderAction icon={<ClipboardCheck size={15} />} label="Attendance" onClick={() => setAttendanceOpen(true)} />
            {isAdmin && (
              <HeaderAction icon={<Cog size={15} />} label="Settings" onClick={() => setSettingsOpen(true)} />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* min-w-0 is load-bearing: it lets a wide table or long URL inside the
            markdown page scroll instead of stretching the row and squashing the
            calendar. */}
        <div className="flex-1 min-w-0">
          <PortalContent
            portalId={portal.id}
            canEdit={isAdmin}
            content={portal.content}
            onSaved={(content) => setPortal((p) => (p ? { ...p, content } : p))}
            editing={editing}
            onEditingChange={setEditing}
          />
        </div>

        <div className="w-full lg:w-80 lg:flex-shrink-0 order-first lg:order-none">
          <CalendarPanel portalId={portal.id} portalName={portal.name} portalColor={portal.color} />
        </div>
      </div>

      {isAdmin && (
        <PortalSettingsModal
          portalId={portal.id}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initial={{
            name: portal.name,
            icon: portal.icon ?? "",
            iconUrl: portal.icon_url,
            color: portal.color ?? "",
            description: portal.description ?? "",
          }}
          onMetaSaved={(m) =>
            setPortal((p) =>
              p ? { ...p, name: m.name, icon: m.icon || null, icon_url: m.iconUrl, color: m.color || null, description: m.description || null } : p,
            )
          }
        />
      )}
      <PortalMembersModal
        portalId={portal.id}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        canEdit={isAdmin}
      />
      <PortalAttendanceModal
        portalId={portal.id}
        open={attendanceOpen}
        onOpenChange={setAttendanceOpen}
        canManage={isAdmin}
      />
    </div>
  );
}

function HeaderAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" onClick={onClick} aria-label={label}>
          {icon}
          <span className="hidden md:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      {/* Only needed once the label is hidden. */}
      <TooltipContent className="md:hidden">{label}</TooltipContent>
    </Tooltip>
  );
}
