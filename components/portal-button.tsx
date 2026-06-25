"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function PortalButton() {
  const [destination, setDestination] = useState<"/apply" | "/protected" | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setDestination("/apply");
        return;
      }
      const { data: member } = await supabase
        .from("members")
        .select("active")
        .eq("user_id", session.user.id)
        .maybeSingle();
      setDestination(member?.active ? "/protected" : "/apply");
    });
  }, []);

  if (!destination) return null;

  return (
    <Link
      href={destination}
      className="rounded-md bg-foreground text-background px-6 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
    >
      {destination === "/protected" ? "Dashboard" : "Apply"}
    </Link>
  );
}
