"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileDialog } from "@/components/profile-dialog";
import { useRoleSim } from "@/components/role-simulation-provider";

type MemberInfo = {
  userId: string;
  preferredFirstname: string;
  lastname: string;
  isMember: boolean;
};

export function AppNavbar() {
  const router = useRouter();
  const { isExec } = useRoleSim();
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      const { data: memberData } = await supabase
        .from("members")
        .select("preferred_firstname, lastname, active")
        .eq("user_id", user.id)
        .maybeSingle();

      if (memberData) {
        setMember({
          userId: user.id,
          preferredFirstname: memberData.preferred_firstname ?? "",
          lastname: memberData.lastname ?? "",
          isMember: !!memberData.active,
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
      <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
        <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
          <div className="flex gap-5 items-center font-semibold">
            <Link href="/">Open Portal</Link>
          </div>
          {member && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold hover:opacity-80 transition-opacity focus:outline-none">
                  {initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isExec && (
                  <DropdownMenuItem onSelect={() => router.push("/admin")}>
                    Admin
                  </DropdownMenuItem>
                )}
                {member.isMember && (
                  <DropdownMenuItem onSelect={() => router.push("/protected")}>
                    Dashboard
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/apply")}>
                  Application
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={logout} className="text-red-500 focus:text-red-500">
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </nav>
      {member && (
        <ProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          userId={member.userId}
          onSave={(fields) =>
            setMember((m) =>
              m
                ? { ...m, preferredFirstname: fields.preferred_firstname, lastname: fields.lastname }
                : m,
            )
          }
        />
      )}
    </>
  );
}
