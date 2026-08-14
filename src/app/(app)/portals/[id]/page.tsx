"use client";

import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ClipboardCheck, Cog, Users } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";
import { CalendarPanel } from "@/components/calendar-panel";
import { PortalDetailSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { PortalSettingsModal } from "@/components/portal-settings-modal";
import { PortalMembersModal } from "@/components/portal-members-modal";
import { PortalAttendanceModal } from "@/components/portal-attendance-modal";
import { PortalDefaultIcon } from "@/components/portal-default-icon";

type Portal = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
};

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
        .select("id, name, description, icon, icon_url, color")
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
      <Link
        href="/"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ChevronLeft size={15} /> Dashboard
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {portal.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portal.icon_url}
              alt=""
              className="h-9 w-9 flex-shrink-0 rounded-lg object-cover"
            />
          ) : portal.icon ? (
            <span className="text-2xl leading-none">{portal.icon}</span>
          ) : (
            <PortalDefaultIcon
              className="h-8 w-8 flex-shrink-0 text-foreground"
              style={{ color: portal.color || undefined }}
            />
          )}
          <h1 className="text-3xl font-bold truncate">{portal.name}</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => setMembersOpen(true)}>
            <Users size={15} /> View members
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAttendanceOpen(true)}>
            <ClipboardCheck size={15} /> Attendance
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Cog size={15} /> Settings
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Intentionally blank for now — portal content (tasks, etc.) comes later. */}
        <div className="flex-1 min-w-0" />

        <div className="w-full lg:w-80 lg:flex-shrink-0 order-first lg:order-none">
          <CalendarPanel portalId={portal.id} />
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
