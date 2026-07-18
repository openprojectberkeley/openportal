"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function ProtectedPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/login");
        return;
      }

      const { data: member } = await supabase
        .from("members")
        .select("preferred_firstname, active, email")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!member) {
        router.replace("/onboarding");
        return;
      }

      // Backfill the sign-in email onto the member row only when it's missing
      // (rows created before we stored it). Every OAuth sign-in lands here, so
      // this self-heals on next login. We never overwrite an existing value —
      // the email they signed up with is kept as-is.
      if (!member.email && user.email) {
        await supabase
          .from("members")
          .update({ email: user.email })
          .eq("user_id", user.id);
      }

      if (!member.active) {
        router.replace("/apply");
        return;
      }

      setFirstName(member.preferred_firstname);
    };

    load();
  }, [router]);

  return (
    <div className="flex-1 w-full flex flex-col gap-12">
      <h1 className="text-3xl font-bold">
        {firstName ? `Hi ${firstName}` : "Loading..."}
      </h1>
      <Link
        href="/protected/portals"
        className="text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline w-fit"
      >
        View your portals
      </Link>
    </div>
  );
}
