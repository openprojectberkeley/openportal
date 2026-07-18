"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { PortalType } from "@/components/portals-panel";

type Portal = {
  id: string;
  type: PortalType;
  name: string;
  description: string | null;
  metadata: { client?: string };
};

type Member = { user_id: string; name: string; role: "member" | "lead" };

export default function PortalDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [portal, setPortal] = useState<Portal | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/login");
        return;
      }

      const [{ data: portalRow }, { data: memberRows }] = await Promise.all([
        supabase
          .from("portals")
          .select("id, type, name, description, metadata")
          .eq("id", params.id)
          .maybeSingle(),
        supabase
          .from("portal_members")
          .select("user_id, role, members(user_id, preferred_firstname, lastname)")
          .eq("portal_id", params.id),
      ]);

      setPortal(portalRow ?? null);
      setMembers(
        (memberRows ?? []).map((row) => {
          const m = row.members as unknown as { user_id: string; preferred_firstname: string | null; lastname: string | null } | null;
          const name = m ? [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "—" : "—";
          return { user_id: row.user_id, name, role: row.role as "member" | "lead" };
        }),
      );
    };

    load();
  }, [router, params.id]);

  if (portal === undefined) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (portal === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/protected/portals" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
          <ArrowLeft size={14} /> Back to portals
        </Link>
        <p className="text-sm text-muted-foreground">Portal not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/protected/portals" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
        <ArrowLeft size={14} /> Back to portals
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-3xl font-bold">{portal.name}</h1>
          <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium capitalize">
            {portal.type}
          </span>
          {portal.metadata?.client && (
            <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium">
              {portal.metadata.client}
            </span>
          )}
        </div>
        {portal.description && <p className="text-muted-foreground">{portal.description}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Members
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            {members.map((m, i) => (
              <div key={m.user_id} className={`flex items-center gap-2 px-4 py-2.5 text-sm ${i > 0 ? "border-t" : ""}`}>
                <span className="flex-1">{m.name}</span>
                {m.role === "lead" && (
                  <span className="px-2 py-0.5 rounded-full bg-foreground text-background text-xs font-medium">
                    Lead
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
