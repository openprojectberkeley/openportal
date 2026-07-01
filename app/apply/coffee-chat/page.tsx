"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CoffeeChatCard, type CoffeeChatCardProps } from "@/components/coffee-chat-card";
import { PLACEHOLDER_PEOPLE } from "@/lib/coffee-chat-people";

type MemberCard = CoffeeChatCardProps & { user_id: string };

export default function CoffeeChatPage() {
  const router = useRouter();
  const [members, setMembers] = useState<MemberCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      const { data: boardExecEntries } = await supabase
        .from("members_roles")
        .select("user_id, roles!inner(id, role_name, access_level)")
        .in("roles.access_level", ["board", "exec"]);

      if (!boardExecEntries?.length) { setLoading(false); return; }

      const userIds = [...new Set(boardExecEntries.map((e) => e.user_id))];

      const [{ data: allRoles }, { data: profiles }] = await Promise.all([
        supabase.from("members_roles").select("user_id, roles(id, role_name)").in("user_id", userIds),
        supabase.from("members").select("user_id, preferred_firstname, lastname, avatar_url, interests").in("user_id", userIds),
      ]);

      const rolesMap = new Map<string, { id: string; role_name: string }[]>();
      for (const entry of allRoles ?? []) {
        if (!rolesMap.has(entry.user_id)) rolesMap.set(entry.user_id, []);
        if (entry.roles) rolesMap.get(entry.user_id)!.push(entry.roles as any);
      }

      setMembers(
        (profiles ?? []).map((p) => ({
          id: p.user_id,
          user_id: p.user_id,
          name: [p.preferred_firstname, p.lastname].filter(Boolean).join(" ") || "Unknown",
          roles: rolesMap.get(p.user_id) ?? [],
          avatarUrl: p.avatar_url ?? null,
          interests: p.interests ?? null,
        })),
      );
      setLoading(false);
    };

    load();
  }, []);

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/apply" className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <h1 className="text-2xl font-bold">Coffee Chat</h1>
        <p className="text-sm text-muted-foreground">Book a 1:1 with a member of our team.</p>
      </div>

      {!loading && members.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Our Team</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map((m) => (
              <CoffeeChatCard
                key={m.user_id}
                id={m.user_id}
                name={m.name}
                roles={m.roles}
                avatarUrl={m.avatarUrl}
                interests={m.interests}
                onBook={() => router.push(`/apply/coffee-chat/book/${m.user_id}`)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">More People</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLACEHOLDER_PEOPLE.map((p) => (
            <CoffeeChatCard
              key={p.id}
              {...p}
              onBook={() => router.push(`/apply/coffee-chat/book/${p.id}`)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
