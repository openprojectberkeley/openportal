"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CoffeeChatCard, type CoffeeChatCardProps } from "@/components/coffee-chat-card";
import { PersonName, initials } from "@/components/person-profile-provider";
import { gcalUrl } from "@/lib/gcal";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { loadCoffeeChatWindowBounds, earliestBookableIso } from "@/lib/coffee-chat-window";
import { CoffeeTeamGrid } from "@/components/coffee-team-grid";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { roleRank, sortRoles } from "@/lib/role-order";
import { CalendarPlus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { background, optimistic, sessionUserId } from "@/lib/optimistic";
import { BackLink } from "@/components/back-link";

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
  memberAvatarUrl: string | null;
  location: string | null;
  message: string | null;
  isPast: boolean;
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

    const [{ data: allRoles }, { data: profiles }, { data: myChats }] = await Promise.all([
      supabase.from("members_roles").select("user_id, roles(id, role_name, access_level)").in("user_id", userIds),
      supabase.from("members").select("user_id, preferred_firstname, lastname, interests, avatar_url").in("user_id", userIds),
      // Past chats are fetched too (not just `.gte(meeting_time, now)`) so they
      // can still be shown, grayed out, under a "Past" section below.
      user
        ? supabase
            .from("coffee_chats")
            .select("id, member_id, meeting_time, duration_minutes, location, message")
            .eq("applicant_id", user.id)
            .order("meeting_time", { ascending: true })
        : Promise.resolve({ data: [] as { id: string; member_id: string; meeting_time: string; duration_minutes: number; location: string | null; message: string | null }[] }),
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
      if (entry.roles) rolesMap.get(entry.user_id)!.push(entry.roles as unknown as { id: string; role_name: string; access_level: string | null });
    }

    const nameMap = new Map<string, string>();
    const avatarMap = new Map<string, string | null>();
    for (const p of profiles ?? []) {
      nameMap.set(p.user_id, [p.preferred_firstname, p.lastname].filter(Boolean).join(" ") || "Unknown");
      avatarMap.set(p.user_id, p.avatar_url ?? null);
    }

    // Members the current user has already booked — one *upcoming* chat per
    // person max. A past chat with someone doesn't block booking a new one.
    const nowMs = Date.now();
    const bookedMemberIds = new Set(
      (myChats ?? []).filter((c) => new Date(c.meeting_time).getTime() >= nowMs).map((c) => c.member_id),
    );

    // Ordering: President, then VPs, then any other exec, then PMs/board (see
    // roleRank). A member sits at their highest-ranking role; role name
    // (alphabetical) then person name break ties.
    const memberRank = (userId: string) => {
      const roles = rolesMap.get(userId) ?? [];
      if (roles.length === 0) return { tier: Infinity, role: "" };
      const best = roles.reduce((a, b) => (roleRank(a) <= roleRank(b) ? a : b));
      return { tier: roleRank(best), role: best.role_name };
    };

    const memberCards = (profiles ?? []).map((p) => ({
      id: p.user_id,
      user_id: p.user_id,
      name: nameMap.get(p.user_id) ?? "Unknown",
      roles: sortRoles(rolesMap.get(p.user_id) ?? []).map(({ id, role_name }) => ({ id, role_name })),
      avatarUrl: p.avatar_url ?? null,
      interests: p.interests ?? null,
      bookable: bookableMemberIds.has(p.user_id),
      booked: bookedMemberIds.has(p.user_id),
    }));

    memberCards.sort((a, b) => {
      const ra = memberRank(a.user_id);
      const rb = memberRank(b.user_id);
      if (ra.tier !== rb.tier) return ra.tier - rb.tier;
      if (ra.role !== rb.role) return ra.role.localeCompare(rb.role);
      return a.name.localeCompare(b.name);
    });

    setMembers(memberCards);

    setBookings(
      (myChats ?? []).map((c) => ({
        id: c.id,
        meeting_time: c.meeting_time,
        duration_minutes: c.duration_minutes,
        memberName: nameMap.get(c.member_id) ?? "Unknown",
        memberUserId: c.member_id,
        memberAvatarUrl: avatarMap.get(c.member_id) ?? null,
        location: c.location ?? null,
        message: c.message ?? null,
        isPast: new Date(c.meeting_time).getTime() < nowMs,
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
    const userId = await sessionUserId(supabase);
    if (!userId) return false;
    const user = { id: userId };

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

    // Past the rate limit (which must be checked first), the cancel is shown
    // at once: the booking leaves the list and the host's card flips back to
    // bookable. Notify, release and log run behind it; a refusal puts the
    // booking back and toasts. Either way a background reload re-derives the
    // freed slot from the DB (no full page reload any more).
    const bookingsBefore = bookings;
    const membersBefore = members;
    setCancelTarget(null);
    void optimistic({
      label: "cancellation",
      key: `coffee-cancel:${booking.id}`,
      apply: () => {
        setBookings((prev) => prev.filter((b) => b.id !== booking.id));
        setMembers((prev) =>
          prev.map((m) => (m.user_id === booking.memberUserId ? { ...m, booked: false } : m)),
        );
      },
      rollback: () => {
        setBookings(bookingsBefore);
        setMembers(membersBefore);
      },
      commit: async () => {
        // Notify the host first (the row still binds both parties), then release.
        await supabase.rpc("notify_coffee_chat_counterparty", {
          p_chat_id: booking.id,
          p_type: "chat_cancelled_by_applicant",
          p_message: null,
        });
        // Free the slot back up — guard on applicant_id so we only clear our
        // own. Confirm via `error`, not the returned rows: the freed row
        // (applicant_id null, member someone else) can fall outside our SELECT
        // visibility, so a successful release could return zero rows.
        const { error } = await supabase
          .from("coffee_chats")
          .update({ applicant_id: null })
          .eq("id", booking.id)
          .eq("applicant_id", user.id);
        if (error) return { error };
        // Log the cancellation for the rate limit.
        background(
          () =>
            supabase.from("coffee_chat_cancellations").insert({
              user_id: user.id,
              coffee_chat_id: booking.id,
              member_id: booking.memberUserId,
              meeting_time: booking.meeting_time,
            }),
          "log coffee chat cancellation",
        );
        return { error: null };
      },
      onCommitted: () => void load(),
    });
    return true;
  };

  const upcomingBookings = bookings.filter((b) => !b.isPast);
  // Fetched oldest-first overall; show the most recent past chat first.
  const pastBookings = bookings.filter((b) => b.isPast).slice().reverse();

  const renderBooking = (b: Booking) => {
    const d = new Date(b.meeting_time);
    return (
      <div
        key={b.id}
        className="group flex items-start justify-between gap-4 rounded-lg px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
      >
        <div className="flex items-start gap-3 min-w-0">
          {b.memberAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.memberAvatarUrl} alt="" className="h-9 w-9 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="h-9 w-9 rounded-full bg-foreground/10 flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {initials(b.memberName)}
            </div>
          )}
          <div className="flex flex-col gap-0.5 min-w-0">
            <PersonName userId={b.memberUserId} name={b.memberName} className="text-sm font-medium" />
            <p className="text-xs text-muted-foreground">
              {d.toLocaleString("en-US", {
                weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
              {" · "}
              {b.duration_minutes} min
            </p>
            {b.location && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                <MapPin size={12} className="flex-shrink-0" aria-hidden />
                {/^https?:\/\//.test(b.location) ? (
                  <a href={b.location} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 text-brand hover:text-brand/80 truncate">
                    {b.location}
                  </a>
                ) : (
                  <span className="truncate">{b.location}</span>
                )}
              </p>
            )}
            {b.message && (
              <p className="text-xs text-muted-foreground italic">&ldquo;{b.message}&rdquo;</p>
            )}
          </div>
        </div>
        {!b.isPast && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
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
                    aria-label="Add to Google Calendar"
                  >
                    <CalendarPlus />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add to Google Calendar</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setCancelTarget(b); setCancelError(null); }}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BackLink href="/" label="Dashboard" />
        <h1 className="text-2xl font-bold tracking-tight">Coffee chat</h1>
      </div>

      {loading ? (
        <section className="flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-4 w-24 rounded-full" />
          <div className="-mx-4 flex flex-col gap-0.5">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <Skeleton className="h-3.5 w-32 rounded-full" />
                  <Skeleton className="h-3 w-44 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {upcomingBookings.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold tracking-tight">
                Upcoming<span className="ml-1.5 font-normal text-muted-foreground">{upcomingBookings.length}</span>
              </h2>
              <div className="-mx-4 flex flex-col gap-0.5">{upcomingBookings.map(renderBooking)}</div>
            </section>
          )}
          {pastBookings.length > 0 && (
            <Disclosure label={`Past ${pastBookings.length}`}>
              <div className="-mx-4 -mt-2 flex flex-col gap-0.5 text-muted-foreground [contain:inline-size]">{pastBookings.map(renderBooking)}</div>
            </Disclosure>
          )}
        </>
      )}

      <CoffeeTeamGrid
        members={members}
        loading={loading}
        renderItem={(m) => (
          <CoffeeChatCard
            id={m.user_id}
            name={m.name}
            roles={m.roles}
            avatarUrl={m.avatarUrl}
            interests={m.interests}
            disabled={!m.bookable}
            booked={m.booked}
            onBook={() => router.push(`/coffee-chat/book/${m.user_id}`)}
          />
        )}
      />

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
        {cancelError && <p className="text-sm text-destructive">{cancelError}</p>}
      </ConfirmDialog>
    </div>
  );
}
