"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CoffeeChatCard, type CoffeeChatCardProps } from "@/components/coffee-chat-card";

type MemberCard = CoffeeChatCardProps & { user_id: string };

const PLACEHOLDERS: Omit<CoffeeChatCardProps, "onBook">[] = [
  { name: "Alex Chen", roles: [{ id: "p1", role_name: "President" }], avatarUrl: null, interests: "Machine learning, product design, hiking" },
  { name: "Jordan Lee", roles: [{ id: "p2", role_name: "VP Engineering" }], avatarUrl: null, interests: "Distributed systems, rock climbing, specialty coffee" },
  { name: "Maya Patel", roles: [{ id: "p3", role_name: "Exec" }], avatarUrl: null, interests: "Biotech, yoga, reading sci-fi" },
  { name: "Ethan Kim", roles: [{ id: "p4", role_name: "Board" }], avatarUrl: null, interests: "Venture capital, tennis, philosophy" },
  { name: "Sofia Torres", roles: [{ id: "p5", role_name: "Director" }], avatarUrl: null, interests: "UX research, ceramics, film photography" },
  { name: "Liam Zhang", roles: [{ id: "p6", role_name: "Exec" }, { id: "p6b", role_name: "Board" }], avatarUrl: null, interests: "Robotics, cycling, competitive chess" },
  { name: "Ava Nguyen", roles: [{ id: "p7", role_name: "VP Marketing" }], avatarUrl: null, interests: "Brand strategy, painting, running" },
  { name: "Noah Park", roles: [{ id: "p8", role_name: "Board" }], avatarUrl: null, interests: "Fintech, guitar, travel" },
  { name: "Isabella Moore", roles: [{ id: "p9", role_name: "Exec" }], avatarUrl: null, interests: "Sustainability, cooking, SCUBA diving" },
  { name: "James Liu", roles: [{ id: "p10", role_name: "Director" }], avatarUrl: null, interests: "Developer tools, bouldering, jazz" },
  { name: "Mia Johnson", roles: [{ id: "p11", role_name: "Board" }], avatarUrl: null, interests: "Health tech, pilates, poetry" },
  { name: "Lucas Martinez", roles: [{ id: "p12", role_name: "VP Operations" }], avatarUrl: null, interests: "Supply chain, woodworking, basketball" },
  { name: "Charlotte Brown", roles: [{ id: "p13", role_name: "Exec" }], avatarUrl: null, interests: "EdTech, watercolor, podcasting" },
  { name: "Henry Wilson", roles: [{ id: "p14", role_name: "Board" }], avatarUrl: null, interests: "Cybersecurity, skiing, board games" },
  { name: "Amelia Davis", roles: [{ id: "p15", role_name: "Director" }], avatarUrl: null, interests: "Social impact, dance, urban farming" },
  { name: "Oliver Garcia", roles: [{ id: "p16", role_name: "Exec" }], avatarUrl: null, interests: "AR/VR, surfing, video production" },
  { name: "Harper Taylor", roles: [{ id: "p17", role_name: "Board" }], avatarUrl: null, interests: "Climate tech, swimming, creative writing" },
  { name: "Elijah Anderson", roles: [{ id: "p18", role_name: "VP Finance" }], avatarUrl: null, interests: "Crypto, golf, mentorship" },
  { name: "Abigail Thomas", roles: [{ id: "p19", role_name: "Exec" }], avatarUrl: null, interests: "Bioengineering, hiking, astronomy" },
  { name: "Sebastian Jackson", roles: [{ id: "p20", role_name: "Board" }], avatarUrl: null, interests: "AI policy, sailing, architecture" },
];

export default function CoffeeChatPage() {
  const [members, setMembers] = useState<MemberCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    const load = async () => {
      // Get user_ids of board/exec members
      const { data: boardExecEntries } = await supabase
        .from("members_roles")
        .select("user_id, roles!inner(id, role_name, access_level)")
        .in("roles.access_level", ["board", "exec"]);

      if (!boardExecEntries?.length) { setLoading(false); return; }

      const userIds = [...new Set(boardExecEntries.map((e) => e.user_id))];

      // Fetch all roles and member profiles in parallel
      const [{ data: allRoles }, { data: profiles }] = await Promise.all([
        supabase
          .from("members_roles")
          .select("user_id, roles(id, role_name)")
          .in("user_id", userIds),
        supabase
          .from("members")
          .select("user_id, preferred_firstname, lastname, avatar_url, interests")
          .in("user_id", userIds),
      ]);

      // Group roles by user
      const rolesMap = new Map<string, { id: string; role_name: string }[]>();
      for (const entry of allRoles ?? []) {
        if (!rolesMap.has(entry.user_id)) rolesMap.set(entry.user_id, []);
        if (entry.roles) rolesMap.get(entry.user_id)!.push(entry.roles as any);
      }

      const cards: MemberCard[] = (profiles ?? []).map((p) => ({
        user_id: p.user_id,
        name: [p.preferred_firstname, p.lastname].filter(Boolean).join(" ") || "Unknown",
        roles: rolesMap.get(p.user_id) ?? [],
        avatarUrl: p.avatar_url ?? null,
        interests: p.interests ?? null,
      }));

      setMembers(cards);
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
                name={m.name}
                roles={m.roles}
                avatarUrl={m.avatarUrl}
                interests={m.interests}
                onBook={() => {}}
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">More People</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLACEHOLDERS.map((p) => (
            <CoffeeChatCard
              key={p.name}
              {...p}
              onBook={() => {}}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
