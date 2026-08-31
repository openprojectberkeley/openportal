"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CoffeeChatCard } from "@/components/coffee-chat-card";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { loadCoffeeChatWindowBounds } from "@/lib/coffee-chat-window";
import { CoffeeTeamSkeleton } from "@/components/skeletons";
import { roleRank, sortRoles } from "@/lib/role-order";

type MemberCard = {
  user_id: string;
  name: string;
  roles: { id: string; role_name: string }[];
  avatarUrl: string | null;
  interests: string | null;
  open: number; // distinct open meeting_times
  booked: number; // claimed seats
};

// Read-only overview for PMs/execs: every board member and their coffee-chat
// availability, with no ability to book. Gated by /manager's ManagerGuard
// (board/exec only) — see manager/layout.tsx. Mirrors the member browse page
// (coffee-chat/page.tsx) minus every booking/cancel path.
export default function EveryoneAvailabilityPage() {
  const [members, setMembers] = useState<MemberCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();

    // The team is board/exec plus every project PM (PMs count as board) — same
    // definition the member browse page uses.
    const [{ data: boardExecEntries }, { data: pmEntries }] = await Promise.all([
      supabase
        .from("members_roles")
        .select("user_id, roles!inner(id, role_name, access_level)")
        .in("roles.access_level", ["board", "exec"]),
      supabase
        .from("project_members")
        .select("user_id")
        .eq("is_pm", true),
    ]);

    const userIds = [
      ...new Set([
        ...(boardExecEntries ?? []).map((e) => e.user_id),
        ...(pmEntries ?? []).map((e) => e.user_id),
      ]),
    ];

    if (userIds.length === 0) { setLoading(false); return; }

    const [{ data: allRoles }, { data: profiles }] = await Promise.all([
      supabase.from("members_roles").select("user_id, roles(id, role_name, access_level)").in("user_id", userIds),
      supabase.from("members").select("user_id, preferred_firstname, lastname, interests, avatar_url").in("user_id", userIds),
    ]);

    // Availability is one row per seat, so a full window easily exceeds
    // Supabase's 1000-row cap — page through with .range() (ordered by
    // member_id, id as a stable tiebreaker) so no member is truncated away.
    // For each member: distinct open meeting_times ("open times") and claimed
    // seats ("booked"). Lower bound is the later of the window start and now, so
    // past slots drop out (viewing, so no 6h minimum-notice floor).
    const { startIso, endExclusiveIso } = await loadCoffeeChatWindowBounds(supabase);
    const nowIso = new Date().toISOString();
    const lowerIso = startIso > nowIso ? startIso : nowIso;
    const PAGE_SIZE = 1000;
    const openTimes = new Map<string, Set<string>>(); // member_id -> set of open meeting_times
    const bookedCount = new Map<string, number>(); // member_id -> claimed seats
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page } = await supabase
        .from("coffee_chats")
        .select("member_id, id, meeting_time, applicant_id")
        .in("member_id", userIds)
        .gte("meeting_time", lowerIso)
        .lt("meeting_time", endExclusiveIso)
        .order("member_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (!page?.length) break;
      for (const row of page) {
        if (row.applicant_id === null) {
          if (!openTimes.has(row.member_id)) openTimes.set(row.member_id, new Set());
          openTimes.get(row.member_id)!.add(new Date(row.meeting_time).toISOString());
        } else {
          bookedCount.set(row.member_id, (bookedCount.get(row.member_id) ?? 0) + 1);
        }
      }
      if (page.length < PAGE_SIZE) break;
    }

    const rolesMap = new Map<string, { id: string; role_name: string; access_level: string | null }[]>();
    for (const entry of allRoles ?? []) {
      if (!rolesMap.has(entry.user_id)) rolesMap.set(entry.user_id, []);
      if (entry.roles) rolesMap.get(entry.user_id)!.push(entry.roles as any);
    }

    const nameMap = new Map<string, string>();
    for (const p of profiles ?? []) {
      nameMap.set(p.user_id, [p.preferred_firstname, p.lastname].filter(Boolean).join(" ") || "Unknown");
    }

    // Ordering matches the member browse page: President → VPs → other exec →
    // PMs/board (roleRank), then role name then person name.
    const memberRank = (userId: string) => {
      const roles = rolesMap.get(userId) ?? [];
      if (roles.length === 0) return { tier: Infinity, role: "" };
      const best = roles.reduce((a, b) => (roleRank(a) <= roleRank(b) ? a : b));
      return { tier: roleRank(best), role: best.role_name };
    };

    const memberCards: MemberCard[] = (profiles ?? []).map((p) => ({
      user_id: p.user_id,
      name: nameMap.get(p.user_id) ?? "Unknown",
      roles: sortRoles(rolesMap.get(p.user_id) ?? []).map(({ id, role_name }) => ({ id, role_name })),
      avatarUrl: p.avatar_url ?? null,
      interests: p.interests ?? null,
      open: openTimes.get(p.user_id)?.size ?? 0,
      booked: bookedCount.get(p.user_id) ?? 0,
    }));

    memberCards.sort((a, b) => {
      const ra = memberRank(a.user_id);
      const rb = memberRank(b.user_id);
      if (ra.tier !== rb.tier) return ra.tier - rb.tier;
      if (ra.role !== rb.role) return ra.role.localeCompare(rb.role);
      return a.name.localeCompare(b.name);
    });

    setMembers(memberCards);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRefreshOnReturn(load);

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/manager/coffee-chats" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Everyone&apos;s Availability</h1>
        <p className="text-sm text-muted-foreground">
          Every board member&apos;s coffee-chat availability, view-only. Tap a person to see their times.
        </p>
      </div>

      {loading ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Our Team</h2>
          <CoffeeTeamSkeleton />
        </section>
      ) : members.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Our Team <span className="text-xs font-normal text-muted-foreground/60">({members.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map((m) => (
              <Link
                key={m.user_id}
                href={`/manager/coffee-chats/all/${m.user_id}`}
                className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CoffeeChatCard
                  id={m.user_id}
                  name={m.name}
                  roles={m.roles}
                  avatarUrl={m.avatarUrl}
                  interests={m.interests}
                  summary={{ open: m.open, booked: m.booked }}
                />
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No team members available for coffee chats right now.</p>
      )}
    </div>
  );
}
