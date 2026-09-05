"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { loadCoffeeChatWindowBounds, earliestBookableIso } from "@/lib/coffee-chat-window";
import { bucketOpenSlots, groupSlotsByDay, keepSelectionIfOpen, type DayGroup } from "@/lib/coffee-chat-slots";
import { AvailabilitySkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { MapPin, Info } from "lucide-react";

type PersonInfo = {
  name: string;
  roles: { id: string; role_name: string }[];
  avatarUrl: string | null;
  interests: string | null;
  defaultLocation: string | null;
};

// useParams() reads uncached route data; cacheComponents requires it to sit
// inside a Suspense boundary so the page shell can still prerender.
export default function BookingPage() {
  return (
    <Suspense fallback={null}>
      <BookingPageInner />
    </Suspense>
  );
}

function BookingPageInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [person, setPerson] = useState<PersonInfo | null>(null);
  const [days, setDays] = useState<DayGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // meeting_time ISO
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    const supabase = createClient();

    // Only offer slots that fall inside the current coffee-chat window.
    // Availability created under an older, wider window stays stored but must
    // not be bookable once the window is cut back. Lower bound is the later of
    // the window start and "now + 6h" — the minimum notice required to book —
    // so both past slots and short-notice slots are excluded.
    const { startIso, endExclusiveIso } = await loadCoffeeChatWindowBounds(supabase);
    const earliestIso = earliestBookableIso();
    const lowerIso = startIso > earliestIso ? startIso : earliestIso;

    const { data: rows } = await supabase
      .from("coffee_chats")
      .select("meeting_time, applicant_id, duration_minutes")
      .eq("member_id", id)
      .gte("meeting_time", lowerIso)
      .lt("meeting_time", endExclusiveIso)
      .order("meeting_time", { ascending: true });

    // Resolve the ids of everyone already booked (across all slots) to names
    // first, so the pure bucketing can label attendees.
    const allApplicantIds = [
      ...new Set((rows ?? []).map((r) => r.applicant_id).filter((x): x is string => x !== null)),
    ];
    const nameMap = new Map<string, string>();
    if (allApplicantIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname")
        .in("user_id", allApplicantIds);
      for (const m of members ?? []) {
        nameMap.set(m.user_id, [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Member");
      }
    }

    // Bucket seat rows into open slots, then group by day (both pure/tested).
    const openSlots = bucketOpenSlots(rows ?? [], (uid) => nameMap.get(uid) ?? "Member");
    setDays(groupSlotsByDay(openSlots));
    // Drop a stale selection: if the time we had picked is no longer open
    // (freed/re-taken elsewhere, or a restored-from-cache render), clear it so
    // we can't try to book a slot that isn't actually available anymore.
    setSelected((cur) => keepSelectionIfOpen(cur, openSlots));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const supabase = createClient();

    const loadPerson = async () => {
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase
          .from("members")
          .select("preferred_firstname, lastname, interests, avatar_url, default_chat_location")
          .eq("user_id", id)
          .maybeSingle(),
        supabase
          .from("members_roles")
          .select("roles(id, role_name)")
          .eq("user_id", id),
      ]);

      setPerson({
        name: [profile?.preferred_firstname, profile?.lastname].filter(Boolean).join(" ") || "Member",
        roles: (roleRows ?? []).flatMap((r: any) => (r.roles ? [r.roles] : [])),
        avatarUrl: profile?.avatar_url ?? null,
        interests: profile?.interests ?? null,
        defaultLocation: profile?.default_chat_location ?? null,
      });
    };

    loadPerson();
    loadSlots();
  }, [id, loadSlots]);

  // Refetch availability when returning via back button, bfcache, or tab
  // switch, so a slot freed/taken elsewhere isn't shown from a stale render.
  useRefreshOnReturn(loadSlots);

  const handleBook = async () => {
    if (!selected) return;
    setBooking(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("You must be signed in to book."); setBooking(false); return; }

    // Claim a seat atomically on the server. book_coffee_chat re-checks every
    // rule (minimum notice, in-window, not self, one-upcoming-per-person) and
    // claims one open row in a single transaction, closing the races the old
    // client-side pre-check + conditional UPDATE couldn't (stale page,
    // double-click, two tabs). It returns the booked row id, or raises a known
    // error message we map to copy below.
    const { data: chatId, error: bookError } = await supabase.rpc("book_coffee_chat", {
      p_member_id: id,
      p_meeting_time: selected,
      p_message: message.trim() || null,
    });

    if (bookError) {
      const msg = bookError.message ?? "";
      if (msg.includes("already_booked")) {
        setError("You already have a coffee chat booked with this person.");
      } else if (msg.includes("self_book")) {
        setError("You can't book a coffee chat with yourself.");
      } else if (msg.includes("too_soon")) {
        setError("Coffee chats must be booked at least 6 hours in advance.");
        await loadSlots();
        setSelected(null);
      } else if (msg.includes("slot_taken") || msg.includes("past_or_out_of_window")) {
        setError("That time is no longer available. Please pick another.");
        await loadSlots();
        setSelected(null);
      } else if (msg.includes("not_authenticated")) {
        // The client thought we were signed in (getUser above passed), but the
        // RPC saw auth.uid() as null — the session token wasn't attached to the
        // request (expired/unrefreshed session, or storage blocked in an in-app
        // browser). Tell the user how to recover rather than "try again".
        setError("Your session has expired. Please sign out and sign in again to book.");
      } else {
        // Unmapped failure. Surface the raw reason to the console so we can see
        // what these bookings are actually hitting instead of masking it.
        console.error("book_coffee_chat failed:", bookError);
        setError("Couldn't book that time. Please try again.");
      }
      setBooking(false);
      return;
    }

    // Notify the host of the new booking (row now binds applicant = caller).
    await supabase.rpc("notify_coffee_chat_counterparty", {
      p_chat_id: chatId,
      p_type: "chat_booked",
      p_message: null,
    });

    // Reset transient state before leaving. Next keeps this client page alive
    // in its Router Cache (cacheComponents), so if it's reused on a later visit
    // without these resets the button comes back stuck on "Booking…".
    setBooking(false);
    setSelected(null);
    setMessage("");
    // Invalidate the Router Cache so the list — and this page on a later visit —
    // remount and refetch instead of reusing a stale cached instance.
    router.refresh();
    router.push("/coffee-chat");
  };

  const initials = person?.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "";

  const firstName = person?.name.split(" ")[0] ?? "them";

  // The currently selected slot object (for its duration, capacity, attendees).
  const selectedSlot = selected
    ? days.flatMap((d) => d.slots).find((s) => s.meeting_time === selected) ?? null
    : null;

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-6">
      <Link href="/coffee-chat" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>

      {/* Always-on explainer for the filled/capacity badge and shared (group) slots. */}
      <div className="flex items-start gap-2.5 rounded-lg border bg-accent/50 p-3 text-sm text-muted-foreground">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <p className="leading-snug">
          <span className="font-medium text-foreground">Some time slots are shared.</span>{" "}
          The badge on a time (like <span className="tabular-nums font-medium text-foreground">2/3</span>)
          shows how many seats are already booked out of the total. A slot with more than one seat — or
          one that already has bookings — is a <span className="font-medium text-foreground">group chat</span>,
          so you may be meeting people you don&apos;t know yet. Times with no badge are one-on-one.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 md:items-start">
        {/* Left: host header + time selection (two-thirds). */}
        <div className="flex flex-col gap-8 md:w-2/3">
          {person && (
            <div className="flex items-center gap-4">
              {person.avatarUrl ? (
                <img src={person.avatarUrl} alt={person.name} className="h-14 w-14 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="h-14 w-14 rounded-full bg-foreground/10 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {initials}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <PersonName
                  userId={id}
                  name={person.name}
                  preloaded={{ roles: person.roles, avatar_url: person.avatarUrl, interests: person.interests }}
                  className="font-semibold"
                />
                <div className="flex flex-wrap gap-1">
                  {person.roles.map((r) => (
                    <span key={r.id} className="px-2 py-0.5 rounded-full bg-foreground/10 text-xs font-medium">
                      {r.role_name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6">
            <h2 className="font-semibold">Select a time</h2>
            {loading ? (
              <AvailabilitySkeleton />
            ) : days.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open times right now. Check back later.</p>
            ) : (
              days.map((day) => (
                <div key={day.label} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-muted-foreground">{day.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {day.slots.map((slot) => {
                      const isSelected = selected === slot.meeting_time;
                      return (
                        <button
                          key={slot.meeting_time}
                          onClick={() => setSelected(slot.meeting_time)}
                          className={`group relative flex flex-col items-center px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
                            isSelected
                              ? "bg-foreground text-background border-foreground"
                              : "hover:bg-accent"
                          }`}
                        >
                          {slot.timeLabel}
                          <span className={`flex items-center gap-1.5 text-[11px] font-normal ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                            <span>{slot.duration_minutes} min</span>
                            {slot.capacity > 1 && (
                              <>
                                <span className="h-1 w-1 rounded-full bg-current" />
                                <span className="tabular-nums">{slot.filled}/{slot.capacity}</span>
                              </>
                            )}
                          </span>
                          {slot.attendees.length > 0 && (
                            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-max max-w-[14rem] -translate-x-1/2 flex-col gap-0.5 rounded-md bg-foreground px-2.5 py-1.5 text-background shadow-lg group-hover:flex">
                              <span className="text-[11px] font-semibold">
                                Booking with {slot.filled} other{slot.filled === 1 ? "" : "s"}
                              </span>
                              <span className="text-[11px] leading-snug opacity-90">
                                {slot.attendees.map((a) => a.name).join(", ")}
                              </span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: about the host + selected-time details + booking (one-third, sticky). */}
        <div className="flex flex-col gap-6 md:w-1/3 md:sticky md:top-6 self-start rounded-lg border p-4">
          {person && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">About {firstName}&apos;s coffee chats</h3>
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                {person.defaultLocation ? (
                  /^https?:\/\//.test(person.defaultLocation) ? (
                    <a
                      href={person.defaultLocation}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground break-all"
                    >
                      {person.defaultLocation}
                    </a>
                  ) : (
                    <span className="break-words">{person.defaultLocation}</span>
                  )
                ) : (
                  <span className="italic">No location set yet — check with {firstName}</span>
                )}
              </div>
              {person.interests && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Interests</p>
                  <p className="text-sm text-muted-foreground leading-snug">{person.interests}</p>
                </div>
              )}
            </div>
          )}

          {days.length > 0 && (
            <div className="flex flex-col gap-3 border-t pt-4">
              {selected ? (
                <>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected time</p>
                    <p className="text-sm font-medium text-foreground">
                      {new Date(selected).toLocaleString("en-US", {
                        weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        timeZoneName: "short",
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedSlot?.duration_minutes ?? 30} min · {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </p>
                  </div>
                  {selectedSlot && selectedSlot.filled > 0 && (
                    <p className="text-xs text-muted-foreground leading-snug">
                      You&apos;ll be joining {selectedSlot.filled} other{selectedSlot.filled === 1 ? "" : "s"}:{" "}
                      <span className="text-foreground">{selectedSlot.attendees.map((a) => a.name).join(", ")}</span>
                    </p>
                  )}
                  <div className="flex flex-col gap-1">
                    <label htmlFor="book-message" className="text-sm font-medium">
                      Add a message <span className="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <textarea
                      id="book-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      maxLength={500}
                      rows={3}
                      placeholder={`Anything you'd like ${firstName} to know before the chat?`}
                      className="border bg-transparent rounded-md px-3 py-2 text-sm w-full resize-none"
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a time to continue.</p>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                disabled={!selected || booking}
                onClick={handleBook}
                className="w-full rounded-md bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-30"
              >
                {booking ? "Booking…" : "Book Meeting"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
