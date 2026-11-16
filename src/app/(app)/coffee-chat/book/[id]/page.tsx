"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, cloneElement, useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { loadCoffeeChatWindowBounds, earliestBookableIso } from "@/lib/coffee-chat-window";
import { bucketOpenSlots, groupSlotsByDay, keepSelectionIfOpen, type DayGroup } from "@/lib/coffee-chat-slots";
import { AvailabilitySkeleton } from "@/components/skeletons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MapPin } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { HostHeader, HostHeaderSkeleton } from "@/components/coffee-host-header";
import { InfoHint } from "@/components/ui/info-hint";
import { Disclosure } from "@/components/ui/disclosure";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
    <Suspense fallback={<BookingPageSkeleton />}>
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
  // Shown once by "Select a time"; read on the client so SSR can't disagree.
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => {
    const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    setTimeZone(part?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

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
        roles: (roleRows ?? []).flatMap((r) => {
          const role = r.roles as unknown as { id: string; role_name: string } | null;
          return role ? [role] : [];
        }),
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


  const firstName = person?.name.split(" ")[0] ?? "them";

  // The currently selected slot object (for its duration, capacity, attendees).
  const allSlots = days.flatMap((d) => d.slots);
  const selectedSlot = selected ? allSlots.find((s) => s.meeting_time === selected) ?? null : null;

  // Radiogroup keyboard: arrows move through every time in order (across
  // days) and select as they go; Home/End jump to the ends.
  const onSlotKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % allSlots.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + allSlots.length) % allSlots.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = allSlots.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setSelected(allSlots[next].meeting_time);
    document.querySelector<HTMLButtonElement>(`[data-slot-index="${next}"]`)?.focus();
  };
  // The focusable radio: the selected one, else the first.
  const tabStop = Math.max(0, allSlots.findIndex((s) => s.meeting_time === selected));
  let slotIndex = -1;

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <BackLink href="/coffee-chat" label="Coffee chat" />

      <div className="flex flex-col md:flex-row gap-8 md:items-start">
        {/* Left: host header + time selection (two-thirds). */}
        <div className="flex flex-col gap-8 md:w-2/3 min-w-0">
          <HostHeader userId={id} host={person} />

          <section className="flex flex-col gap-5">
            <div className="flex items-center gap-1.5">
              <h2 id="select-time" className="text-base font-semibold tracking-tight">Select a time</h2>
              <InfoHint label="About shared times">
                Some times are shared. A badge like 2/3 is seats booked out of the total; a time with more than
                one seat is a group chat, so you may meet people you don&apos;t know yet. No badge means one-on-one.
              </InfoHint>
              {timeZone && days.length > 0 && <span className="ml-auto text-xs text-muted-foreground">Times in {timeZone}</span>}
            </div>
            {loading ? (
              <AvailabilitySkeleton />
            ) : days.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open times right now. Check back later.</p>
            ) : (
              <div role="radiogroup" aria-labelledby="select-time" className="flex flex-col gap-5">
                {days.map((day) => (
                  <div key={day.label} role="group" aria-label={day.label} className="flex flex-col gap-2">
                    <p className="text-sm font-medium text-muted-foreground">{day.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {day.slots.map((slot) => {
                        const i = ++slotIndex;
                        const isSelected = selected === slot.meeting_time;
                        const slotButton = (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            tabIndex={i === tabStop ? 0 : -1}
                            data-slot-index={i}
                            onClick={() => setSelected(slot.meeting_time)}
                            onKeyDown={(e) => onSlotKey(e, i)}
                            className={`flex flex-col items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                              isSelected
                                ? "bg-foreground text-background"
                                : "bg-foreground/[0.05] hover:bg-foreground/[0.09]"
                            }`}
                          >
                            {slot.timeLabel}
                            <span className={`flex items-center gap-1.5 text-[11px] font-normal ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                              <span>{slot.duration_minutes} min</span>
                              {slot.capacity > 1 && (
                                <>
                                  <span className="h-1 w-1 rounded-full bg-current" />
                                  <span>{slot.filled}/{slot.capacity}</span>
                                </>
                              )}
                            </span>
                          </button>
                        );
                        if (slot.attendees.length === 0) {
                          return cloneElement(slotButton, { key: slot.meeting_time });
                        }
                        return (
                          <Tooltip key={slot.meeting_time}>
                            <TooltipTrigger asChild>{slotButton}</TooltipTrigger>
                            <TooltipContent side="top" className="flex max-w-[14rem] flex-col gap-0.5">
                              <span className="font-semibold">
                                Booking with {slot.filled} other{slot.filled === 1 ? "" : "s"}
                              </span>
                              <span className="opacity-90">{slot.attendees.map((a) => a.name).join(", ")}</span>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right: where, the selected time, and booking (one-third, sticky). */}
        <aside className="flex flex-col gap-5 md:w-1/3 md:sticky md:top-6 self-start w-full rounded-xl surface p-4">
          {person ? (
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin size={14} className="mt-0.5 flex-shrink-0" aria-label="Location" />
              {person.defaultLocation ? (
                /^https?:\/\//.test(person.defaultLocation) ? (
                  <a
                    href={person.defaultLocation}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted underline-offset-2 text-brand hover:text-brand/80 break-all"
                  >
                    {person.defaultLocation}
                  </a>
                ) : (
                  <span className="break-words">{person.defaultLocation}</span>
                )
              ) : (
                <span>No location set yet. Check with {firstName}.</span>
              )}
            </div>
          ) : (
            <LocationSkeleton />
          )}

          {loading ? (
            <BookingAsideSkeleton />
          ) : days.length > 0 ? (
            <div className="flex flex-col gap-4">
              {selected ? (
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">
                    {new Date(selected).toLocaleString("en-US", {
                      weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">{selectedSlot?.duration_minutes ?? 30} min</p>
                  {selectedSlot && selectedSlot.filled > 0 && (
                    <p className="pt-1 text-xs text-muted-foreground leading-snug">
                      With {selectedSlot.attendees.map((a) => a.name).join(", ")}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Pick a time to book.</p>
              )}
              {selected && (
                <Disclosure label="Add a message" defaultOpen={message.trim() !== ""}>
                  <Textarea
                    id="book-message"
                    aria-label="Message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder={`Anything you'd like ${firstName} to know before the chat?`}
                    className="resize-none"
                  />
                </Disclosure>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button disabled={!selected || booking} onClick={handleBook} className="w-full">
                {booking ? "Booking…" : "Book a chat"}
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// ---- loading shapes ---------------------------------------------------------

function LocationSkeleton() {
  return (
    <div aria-hidden className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <MapPin size={14} className="mt-0.5 flex-shrink-0" />
      <span className="flex h-5 flex-1 items-center">
        <Skeleton className="h-3.5 w-3/4 rounded-full" />
      </span>
    </div>
  );
}

// Nothing is selected when the times arrive, so this is the aside's real
// first state: the prompt and a disabled Book button.
function BookingAsideSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Pick a time to book.</p>
      <Button disabled className="w-full">Book a chat</Button>
    </div>
  );
}

// Before the route params resolve: the page with nothing fetched yet.
function BookingPageSkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <BackLink href="/coffee-chat" label="Coffee chat" />
      <div className="flex flex-col md:flex-row gap-8 md:items-start">
        <div className="flex flex-col gap-8 md:w-2/3 min-w-0">
          <HostHeaderSkeleton />
          <section className="flex flex-col gap-5">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold tracking-tight">Select a time</h2>
            </div>
            <AvailabilitySkeleton />
          </section>
        </div>
        <aside className="flex flex-col gap-5 md:w-1/3 md:sticky md:top-6 self-start w-full rounded-xl surface p-4">
          <LocationSkeleton />
          <BookingAsideSkeleton />
        </aside>
      </div>
    </div>
  );
}
