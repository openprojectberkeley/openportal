"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CoffeeChatCard, type CoffeeChatCardProps } from "@/components/coffee-chat-card";
import { PersonName } from "@/components/person-profile-provider";
import { gcalUrl } from "@/lib/gcal";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { loadCoffeeChatWindowBounds, earliestBookableIso } from "@/lib/coffee-chat-window";
import { CoffeeTeamSkeleton } from "@/components/skeletons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MapPin } from "lucide-react";

// At most this many cancellations per rolling 24h, to curb slot churn (there's
// no reschedule — moving a chat means cancel + book again).
const CANCEL_LIMIT_24H = 5;

type MemberCard = CoffeeChatCardProps & { user_id: string; bookable: boolean; booked: boolean };

type Booking = {
  id: string;
  meeting_time: string;
  duration_minutes: number;
  memberName: string;
  memberUserId: string;
  location: string | null;
};

export default function CoffeeChatPage() {
  const router = useRouter();
  const [members, setMembers] = useState<MemberCard[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
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
      supabase.from("members_roles").select("user_id, roles(id, role_name, access_level)").in("user_id", userIds),
      supabase.from("members").select("user_id, preferred_firstname, lastname, interests, avatar_url").in("user_id", userIds),
      user
        ? supabase
            .from("coffee_chats")
            .select("id, member_id, meeting_time, duration_minutes, location")
            .eq("applicant_id", user.id)
            .gte("meeting_time", nowIso)
            .order("meeting_time", { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // Which members still have at least one open future slot inside the current
    // coffee-chat window. Availability created under an older, wider window
    // stays stored but must not make a host look bookable once the window is cut
    // back (that would link to an empty booking page). Lower bound is the later
    // of the window start and "now + 6h" (the minimum notice to book) so both
    // past and short-notice slots stay excluded.
    //
    // Each member's availability is stored one row per seat, so across the whole
    // team this easily exceeds Supabase's 1000-row response cap — a single
    // unpaginated read gets entirely consumed by whichever member has the most
    // slots, leaving everyone else looking fully booked. Page through with
    // .range() (open slots only) so every member is represented. member_id isn't
    // unique, so add id as a stable tiebreaker to keep paging deterministic.
    const { startIso, endExclusiveIso } = await loadCoffeeChatWindowBounds(supabase);
    const earliestIso = earliestBookableIso();
    const lowerIso = startIso > earliestIso ? startIso : earliestIso;
    const PAGE_SIZE = 1000;
    const bookableMemberIds = new Set<string>();
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page } = await supabase
        .from("coffee_chats")
        .select("member_id, id")
        .in("member_id", userIds)
        .is("applicant_id", null)
        .gte("meeting_time", lowerIso)
        .lt("meeting_time", endExclusiveIso)
        .order("member_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (!page?.length) break;
      for (const row of page) bookableMemberIds.add(row.member_id);
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

    // Members the current user has already booked — one chat per person max.
    const bookedMemberIds = new Set((myChats ?? []).map((c) => c.member_id));

    // Ordering: President first, then the rest of exec (grouped by role name,
    // alphabetically), then everyone else (board/PMs). Name breaks every tie.
    const PRESIDENT_ROLE = "President";
    const rankOf = (userId: string) => {
      const roles = rolesMap.get(userId) ?? [];
      if (roles.some((r) => r.role_name === PRESIDENT_ROLE)) return { tier: 0, execRole: "" };
      const execRoleNames = roles.filter((r) => r.access_level === "exec").map((r) => r.role_name).sort();
      if (execRoleNames.length > 0) return { tier: 1, execRole: execRoleNames[0] };
      return { tier: 2, execRole: "" };
    };

    const memberCards = (profiles ?? []).map((p) => ({
      id: p.user_id,
      user_id: p.user_id,
      name: nameMap.get(p.user_id) ?? "Unknown",
      roles: (rolesMap.get(p.user_id) ?? []).map(({ id, role_name }) => ({ id, role_name })),
      avatarUrl: p.avatar_url ?? null,
      interests: p.interests ?? null,
      bookable: bookableMemberIds.has(p.user_id),
      booked: bookedMemberIds.has(p.user_id),
    }));

    memberCards.sort((a, b) => {
      const ra = rankOf(a.user_id);
      const rb = rankOf(b.user_id);
      if (ra.tier !== rb.tier) return ra.tier - rb.tier;
      if (ra.tier === 1 && ra.execRole !== rb.execRole) return ra.execRole.localeCompare(rb.execRole);
      return a.name.localeCompare(b.name);
    });

    setMembers(memberCards);

    setBookings(
      (myChats ?? []).map((c: any) => ({
        id: c.id,
        meeting_time: c.meeting_time,
        duration_minutes: c.duration_minutes,
        memberName: nameMap.get(c.member_id) ?? "Unknown",
        memberUserId: c.member_id,
        location: c.location ?? null,
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

  // Cancel is confirmed via the dialog; this runs the mutation. Returns false
  // to keep the dialog open (rate-limited or errored).
  const confirmCancel = async () => {
    const booking = cancelTarget;
    if (!booking) return false;
    setCancelError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // Rate limit: at most CANCEL_LIMIT_24H cancellations per rolling 24h.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("coffee_chat_cancellations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if ((count ?? 0) >= CANCEL_LIMIT_24H) {
      setCancelError(`You've hit the limit of ${CANCEL_LIMIT_24H} cancellations in 24 hours. Try again later.`);
      return false;
    }

    // Notify the host first (the row still binds both parties), then release.
    await supabase.rpc("notify_coffee_chat_counterparty", {
      p_chat_id: booking.id,
      p_type: "chat_cancelled_by_applicant",
      p_message: null,
    });

    // Free the slot back up — guard on applicant_id so we only clear our own.
    // Confirm via `error`, not the returned rows: the freed row (applicant_id
    // null, member someone else) can fall outside our SELECT visibility, so a
    // successful release could still return zero rows and look like a failure.
    const { error } = await supabase
      .from("coffee_chats")
      .update({ applicant_id: null })
      .eq("id", booking.id)
      .eq("applicant_id", user.id);

    if (error) {
      setCancelError("Couldn't cancel that chat. Please try again.");
      return false;
    }

    // Log the cancellation for the rate limit.
    await supabase.from("coffee_chat_cancellations").insert({
      user_id: user.id,
      coffee_chat_id: booking.id,
      member_id: booking.memberUserId,
      meeting_time: booking.meeting_time,
    });

    setCancelTarget(null);
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
          <div className="flex flex-col gap-3">
            {bookings.map((b) => {
              const d = new Date(b.meeting_time);
              return (
                <div key={b.id} className="border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <PersonName userId={b.memberUserId} name={b.memberName} className="text-sm font-medium" />
                    <p className="text-xs text-muted-foreground">
                      {d.toLocaleString("en-US", {
                        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                      {" · "}
                      {b.duration_minutes} min
                    </p>
                    {b.location && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin size={12} className="flex-shrink-0" />
                        {/^https?:\/\//.test(b.location) ? (
                          <a href={b.location} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground truncate">
                            {b.location}
                          </a>
                        ) : (
                          <span className="truncate">{b.location}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={gcalUrl({
                        start: d,
                        durationMs: b.duration_minutes * 60 * 1000,
                        title: `Coffee Chat with ${b.memberName}`,
                        details: "Open Project Berkeley coffee chat.",
                        location: b.location ?? undefined,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center border rounded-md px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      Add to Google Calendar
                    </a>
                    <button
                      onClick={() => { setCancelTarget(b); setCancelError(null); }}
                      className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      Cancel
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

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title="Cancel this coffee chat?"
        description={cancelTarget
          ? `Cancel your chat with ${cancelTarget.memberName} on ${new Date(cancelTarget.meeting_time).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}? This frees the slot for someone else. There's no reschedule — you'd book a new time yourself.`
          : ""}
        confirmLabel="Cancel chat"
        onConfirm={confirmCancel}
      >
        {cancelError && <p className="text-sm text-red-500">{cancelError}</p>}
      </ConfirmDialog>
    </div>
  );
}
