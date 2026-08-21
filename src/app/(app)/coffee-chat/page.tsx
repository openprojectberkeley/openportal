"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CoffeeChatCard, type CoffeeChatCardProps } from "@/components/coffee-chat-card";
import { PersonName } from "@/components/person-profile-provider";
import { gcalUrl } from "@/lib/gcal";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { CoffeeTeamSkeleton } from "@/components/skeletons";

type MemberCard = CoffeeChatCardProps & { user_id: string; bookable: boolean; booked: boolean };

type Booking = {
  id: string;
  meeting_time: string;
  memberName: string;
  memberUserId: string;
};

export default function CoffeeChatPage() {
  const router = useRouter();
  const [members, setMembers] = useState<MemberCard[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // The bookable team is board/exec plus every project PM (PMs count as
    // board, and OP Studio applicants must chat with a project's PM).
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

    const nowIso = new Date().toISOString();

    const [{ data: allRoles }, { data: profiles }, { data: myChats }] = await Promise.all([
      supabase.from("members_roles").select("user_id, roles(id, role_name)").in("user_id", userIds),
      supabase.from("members").select("user_id, preferred_firstname, lastname, interests, avatar_url").in("user_id", userIds),
      user
        ? supabase
            .from("coffee_chats")
            .select("id, member_id, meeting_time")
            .eq("applicant_id", user.id)
            .gte("meeting_time", nowIso)
            .order("meeting_time", { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // Which members still have at least one open future slot. Each member's
    // availability is stored one row per seat, so across the whole team this
    // easily exceeds Supabase's 1000-row response cap — a single unpaginated
    // read gets entirely consumed by whichever member has the most slots,
    // leaving everyone else looking fully booked. Page through with .range()
    // (open slots only) so every member is represented. member_id isn't unique,
    // so add id as a stable tiebreaker to keep paging deterministic.
    const PAGE_SIZE = 1000;
    const bookableMemberIds = new Set<string>();
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page } = await supabase
        .from("coffee_chats")
        .select("member_id, id")
        .in("member_id", userIds)
        .is("applicant_id", null)
        .gte("meeting_time", nowIso)
        .order("member_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (!page?.length) break;
      for (const row of page) bookableMemberIds.add(row.member_id);
      if (page.length < PAGE_SIZE) break;
    }

    const rolesMap = new Map<string, { id: string; role_name: string }[]>();
    for (const entry of allRoles ?? []) {
      if (!rolesMap.has(entry.user_id)) rolesMap.set(entry.user_id, []);
      if (entry.roles) rolesMap.get(entry.user_id)!.push(entry.roles as any);
    }

    const nameMap = new Map<string, string>();
    for (const p of profiles ?? []) {
      nameMap.set(p.user_id, [p.preferred_firstname, p.lastname].filter(Boolean).join(" ") || "Unknown");
    }

    // Members the current user has already booked — one chat per person max.
    const bookedMemberIds = new Set((myChats ?? []).map((c) => c.member_id));

    setMembers(
      (profiles ?? []).map((p) => ({
        id: p.user_id,
        user_id: p.user_id,
        name: nameMap.get(p.user_id) ?? "Unknown",
        roles: rolesMap.get(p.user_id) ?? [],
        avatarUrl: p.avatar_url ?? null,
        interests: p.interests ?? null,
        bookable: bookableMemberIds.has(p.user_id),
        booked: bookedMemberIds.has(p.user_id),
      })),
    );

    setBookings(
      (myChats ?? []).map((c: any) => ({
        id: c.id,
        meeting_time: c.meeting_time,
        memberName: nameMap.get(c.member_id) ?? "Unknown",
        memberUserId: c.member_id,
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
    const booking = bookings.find((b) => b.id === bookingId);
    const when = booking
      ? new Date(booking.meeting_time).toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        })
      : null;
    const message = booking
      ? `Cancel your coffee chat with ${booking.memberName} on ${when}? This frees the slot for someone else.`
      : "Cancel this coffee chat? This frees the slot for someone else.";
    if (!window.confirm(message)) return;

    setCancelling(bookingId);
    setCancelError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCancelling(null); return; }

    // Free the slot back up — guard on applicant_id so we only clear our own.
    // Confirm via `error`, not the returned rows: the freed row (applicant_id
    // null, member someone else) can fall outside our SELECT visibility, so a
    // successful release could still return zero rows and look like a failure.
    const { error } = await supabase
      .from("coffee_chats")
      .update({ applicant_id: null })
      .eq("id", bookingId)
      .eq("applicant_id", user.id);

    if (error) {
      setCancelError("Couldn't cancel that chat. Please try again.");
      setCancelling(null);
      return;
    }

    // Reload so everything re-derives from the DB: the booking disappears,
    // the member's card flips from "Booked" back to bookable, and their freed
    // slot becomes available again.
    window.location.reload();
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Coffee Chat</h1>
        <p className="text-sm text-muted-foreground">Book a 1:1 with a member of our team.</p>
      </div>

      {!loading && bookings.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your Coffee Chats</h2>
          {cancelError && <p className="text-sm text-red-500">{cancelError}</p>}
          <div className="flex flex-col gap-3">
            {bookings.map((b) => {
              const d = new Date(b.meeting_time);
              return (
                <div key={b.id} className="border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <PersonName userId={b.memberUserId} name={b.memberName} className="text-sm font-medium" />
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
              <CoffeeChatCard
                key={m.user_id}
                id={m.user_id}
                name={m.name}
                roles={m.roles}
                avatarUrl={m.avatarUrl}
                interests={m.interests}
                disabled={!m.bookable}
                booked={m.booked}
                onBook={() => router.push(`/coffee-chat/book/${m.user_id}`)}
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
