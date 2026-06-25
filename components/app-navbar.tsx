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

type MemberInfo = {
  userId: string;
  preferredFirstname: string;
  lastname: string;
};

export function AppNavbar() {
  const router = useRouter();
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data } = await supabase
        .from("members")
        .select("preferred_firstname, lastname")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (data) {
        setMember({
          userId: session.user.id,
          preferredFirstname: data.preferred_firstname ?? "",
          lastname: data.lastname ?? "",
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
                <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                  Profile
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
