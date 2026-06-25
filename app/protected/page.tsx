"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ProtectedPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login");
        return;
      }

      const { data: member } = await supabase
        .from("members")
        .select("preferred_firstname, active")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!member) {
        router.replace("/onboarding");
        return;
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
    </div>
  );
}
