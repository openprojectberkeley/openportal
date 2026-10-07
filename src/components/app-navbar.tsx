"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CalendarDays, LayoutDashboard, Trophy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileDialog } from "@/components/profile-dialog";
import { useRoleSim } from "@/components/role-simulation-provider";
import { NotificationBell } from "@/components/notification-bell";
import { OpenPortalBrandIcon } from "@/components/open-portal-brand-icon";
import { NavTabs, NavTabsFallback, type NavTabSpec } from "@/components/nav-tab";

// The header's primary navigation. Adding a destination is one line here; the
// swipe hover and the active-route styling come with NavTab.
const TABS: NavTabSpec[] = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" }, // "exact" by default
  { href: "/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/scoreboard", icon: Trophy, label: "Scoreboard" },
];

type MemberInfo = {
  userId: string;
  preferredFirstname: string;
  lastname: string;
  avatarUrl: string | null;
};

/**
 * `tabs`: onboarding mounts this navbar too, and three tabs inviting the user
 * out of that funnel mid-flow is wrong — so the decision is the layout's, by
 * route, not something derived from loading state.
 */
export function AppNavbar({ tabs = true }: { tabs?: boolean } = {}) {
  const router = useRouter();
  const { isExec, isBoardOrExec } = useRoleSim();
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      const { data: memberData } = await supabase
        .from("members")
        .select("preferred_firstname, lastname, avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();

      if (memberData) {
        setMember({
          userId: user.id,
          preferredFirstname: memberData.preferred_firstname ?? "",
          lastname: memberData.lastname ?? "",
          avatarUrl: memberData.avatar_url ?? null,
        });
      }
    });
  }, []);

  const initials = member
    ? `${member.preferredFirstname[0] ?? ""}${member.lastname[0] ?? ""}`.toUpperCase()
    : "";

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <>
      <nav
        data-app-header
        className="sticky top-0 z-40 w-full flex justify-center border-b border-b-foreground/10 h-16 bg-background"
      >
        <div className="w-full max-w-6xl flex justify-between items-center p-3 px-5 text-sm">
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="Open Portal">
              <OpenPortalBrandIcon className="h-7 w-auto" aria-hidden />
              {/* The brand text drops below sm so three labelled tabs fit. */}
              <span className="hidden sm:inline">Open Portal</span>
            </Link>
            {/* Not gated on `member`: the tabs need only the pathname, and
                gating primary navigation behind two round trips would leave the
                sticky header empty for a few hundred ms on every hard load.
                Unauthenticated requests never reach these routes — src/proxy.ts
                redirects them to the login page. */}
            {tabs && (
              <Suspense fallback={<NavTabsFallback tabs={TABS} />}>
                <NavTabs tabs={TABS} />
              </Suspense>
            )}
          </div>
          {member && (
            <div className="flex items-center gap-1.5">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold hover:opacity-80 transition-opacity focus:outline-none overflow-hidden">
                  {member.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.avatarUrl}
                      alt="Profile picture"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => router.push("/")}>
                  Home
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/resume-review")}>
                  Resume Review
                </DropdownMenuItem>
                {isBoardOrExec && (
                  <DropdownMenuItem onSelect={() => router.push("/manager")}>
                    Application Manager
                  </DropdownMenuItem>
                )}
                {isExec && (
                  <DropdownMenuItem onSelect={() => router.push("/admin")}>
                    Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={logout} className="text-red-500 focus:text-red-500">
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          )}
        </div>
      </nav>
      {member && (
        <ProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          userId={member.userId}
          onSave={(fields, avatarUrl) =>
            setMember((m) =>
              m
                ? {
                    ...m,
                    preferredFirstname: fields.preferred_firstname,
                    lastname: fields.lastname,
                    avatarUrl,
                  }
                : m,
            )
          }
        />
      )}
    </>
  );
}
