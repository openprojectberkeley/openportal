"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PORTAL_TYPES, type PortalType } from "@/components/portals-panel";

type PortalSummary = {
  id: string;
  type: PortalType;
  name: string;
  description: string | null;
  metadata: { client?: string };
};

export default function PortalsListPage() {
  const router = useRouter();
  const [portals, setPortals] = useState<PortalSummary[] | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/login");
        return;
      }

      const { data } = await supabase
        .from("portal_members")
        .select("portal:portals(id, type, name, description, metadata)")
        .eq("user_id", user.id);

      const rows = (data ?? [])
        .map((row) => row.portal as unknown as PortalSummary | null)
        .filter((p): p is PortalSummary => p !== null);
      setPortals(rows);
    };

    load();
  }, [router]);

  if (portals === null) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const grouped = PORTAL_TYPES.map((t) => ({
    ...t,
    portals: portals.filter((p) => p.type === t.value),
  })).filter((g) => g.portals.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-bold">Your portals</h1>

      {grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">
          You&apos;re not a member of any portals yet.
        </p>
      )}

      {grouped.map((group) => (
        <div key={group.value} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {group.label}
          </h2>
          <div className="border rounded-lg overflow-hidden">
            {group.portals.map((p, i) => (
              <Link
                key={p.id}
                href={`/protected/portals/${p.id}`}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors ${i > 0 ? "border-t" : ""}`}
              >
                <span className="font-medium text-sm flex-1">{p.name}</span>
                {p.metadata?.client && (
                  <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium">
                    {p.metadata.client}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
