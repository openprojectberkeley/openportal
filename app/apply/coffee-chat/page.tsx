"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CoffeeChatCard, type CoffeeChatCardProps } from "@/components/coffee-chat-card";
import { gcalUrl } from "@/lib/gcal";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

const REQUIRED_HOURS = 5;

type MemberCard = CoffeeChatCardProps & { user_id: string; bookable: boolean };

type Booking = {
  id: string;
  meeting_time: string;
  memberName: string;
};

export default function CoffeeChatPage() {
  const router = useRouter();
  const [members, setMembers] = useState<MemberCard[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: boardExecEntries } = await supabase
      .from("members_roles")
      .select("user_id, roles!inner(id, role_name, access_level)")
      .in("roles.access_level", ["board", "exec"]);

    if (!boardExecEntries?.length) { setLoading(false); return; }

    const userIds = [...new Set(boardExecEntries.map((e) => e.user_id))];

    const [{ data: allRoles }, { data: profiles }, { data: chats }, { data: myChats }] = await Promise.all([
      supabase.from("members_roles").select("user_id, roles(id, role_name)").in("user_id", userIds),
      supabase.from("members").select("user_id, preferred_firstname, lastname, interests").in("user_id", userIds),
      supabase
        .from("coffee_chats")
        .select("member_id, meeting_time, applicant_id")
        .in("member_id", userIds)
        .gte("meeting_time", new Date().toISOString()),
      user
        ? supabase
            .from("coffee_chats")
            .select("id, member_id, meeting_time")
            .eq("applicant_id", user.id)
            .gte("meeting_time", new Date().toISOString())
            .order("meeting_time", { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const rolesMap = new Map<string, { id: string; role_name: string }[]>();
    for (const entry of allRoles ?? []) {
      if (!rolesMap.has(entry.user_id)) rolesMap.set(entry.user_id, []);
      if (entry.roles) rolesMap.get(entry.user_id)!.push(entry.roles as any);
    }

    const nameMap = new Map<string, string>();
    for (const p of profiles ?? []) {
      nameMap.set(p.user_id, [p.preferred_firstname, p.lastname].filter(Boolean).join(" ") || "Unknown");
    }

    // Count distinct hours each member has set up, and distinct hours still open.
    const setHours = new Map<string, Set<string>>();
    const openHours = new Map<string, Set<string>>();
    for (const c of chats ?? []) {
      const key = new Date(c.meeting_time).toISOString();
      if (!setHours.has(c.member_id)) setHours.set(c.member_id, new Set());
      setHours.get(c.member_id)!.add(key);
      if (c.applicant_id === null) {
        if (!openHours.has(c.member_id)) openHours.set(c.member_id, new Set());
        openHours.get(c.member_id)!.add(key);
      }
    }

    setMembers(
      (profiles ?? []).map((p) => {
        const totalHours = setHours.get(p.user_id)?.size ?? 0;
        const stillOpen = openHours.get(p.user_id)?.size ?? 0;
        return {
          id: p.user_id,
          user_id: p.user_id,
          name: nameMap.get(p.user_id) ?? "Unknown",
          roles: rolesMap.get(p.user_id) ?? [],
          avatarUrl: null,
          interests: p.interests ?? null,
          bookable: totalHours >= REQUIRED_HOURS && stillOpen > 0,
        };
      }),
    );

    setBookings(
      (myChats ?? []).map((c: any) => ({
        id: c.id,
        meeting_time: c.meeting_time,
        memberName: nameMap.get(c.member_id) ?? "Unknown",
      })),
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Re-read bookings/availability when returning via back button, bfcache, or
  // a tab switch — otherwise a booking cancelled here can reappear stale.
  useRefreshOnReturn(load);

  const handleCancel = async (bookingId: string) => {
    setCancelling(bookingId);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCancelling(null); return; }

    // Free the slot back up — guard on applicant_id so we only clear our own.
    // .select() confirms the row actually changed (RLS / already-cancelled).
    const { data: cleared } = await supabase
      .from("coffee_chats")
      .update({ applicant_id: null })
      .eq("id", bookingId)
      .eq("applicant_id", user.id)
      .select();

    if (cleared && cleared.length > 0) {
      // Drop it from local state so it disappears immediately...
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
      // ...and invalidate the Router Cache so the booking page remounts on the
      // next visit — refetching the freed slot and clearing any leftover
      // "Booking…" state — instead of reusing its cached client instance.
      router.refresh();
    }
    setCancelling(null);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/apply" className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <h1 className="text-2xl font-bold">Coffee Chat</h1>
        <p className="text-sm text-muted-foreground">Book a 1:1 with a member of our team.</p>
      </div>

      {!loading && bookings.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your Coffee Chats</h2>
          <div className="flex flex-col gap-3">
            {bookings.map((b) => {
              const d = new Date(b.meeting_time);
              return (
                <div key={b.id} className="border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">{b.memberName}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.toLocaleString("en-US", {
                        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={gcalUrl({
                        start: d,
                        title: `Coffee Chat with ${b.memberName}`,
                        details: "Open Project Berkeley coffee chat.",
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center border rounded-md px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      Add to Google Calendar
                    </a>
                    <button
                      onClick={() => handleCancel(b.id)}
                      disabled={cancelling === b.id}
                      className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      {cancelling === b.id ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : members.length > 0 ? (
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
                disabled={!m.bookable}
                onBook={() => router.push(`/apply/coffee-chat/book/${m.user_id}`)}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No team members available for coffee chats right now.</p>
      )}
    </div>
  );
}
