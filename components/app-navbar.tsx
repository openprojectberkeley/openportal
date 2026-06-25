"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoutButton } from "./logout-button";

export function AppNavbar() {
  const [preferredFirstname, setPreferredFirstname] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data: member } = await supabase
        .from("members")
        .select("preferred_firstname")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (member?.preferred_firstname) {
        setPreferredFirstname(member.preferred_firstname);
      }
    });
  }, []);

  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
      <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center font-semibold">
          <Link href="/">Open Portal</Link>
        </div>
        <div className="flex items-center gap-4">
          {preferredFirstname && <span>Hey, {preferredFirstname}!</span>}
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
