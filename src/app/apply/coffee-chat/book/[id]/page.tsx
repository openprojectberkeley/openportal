"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

type PersonInfo = {
  name: string;
  roles: { id: string; role_name: string }[];
  avatarUrl: string | null;
  interests: string | null;
};

type OpenSlot = {
  meeting_time: string;
  openCount: number;
};

type DayGroup = {
  label: string;
  slots: { meeting_time: string; timeLabel: string; openCount: number }[];
};

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [person, setPerson] = useState<PersonInfo | null>(null);
  const [days, setDays] = useState<DayGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // meeting_time ISO
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    const supabase = createClient();

    const { data: rows } = await supabase
      .from("coffee_chats")
      .select("meeting_time, applicant_id")
      .eq("member_id", id)
      .gte("meeting_time", new Date().toISOString())
      .order("meeting_time", { ascending: true });

    // Count open (unclaimed) rows per meeting_time
    const openMap = new Map<string, number>();
    for (const r of rows ?? []) {
      const key = new Date(r.meeting_time).toISOString();
      if (!openMap.has(key)) openMap.set(key, 0);
      if (r.applicant_id === null) openMap.set(key, openMap.get(key)! + 1);
    }

    const openSlots: OpenSlot[] = [...openMap.entries()]
      .filter(([, count]) => count > 0)
      .map(([meeting_time, openCount]) => ({ meeting_time, openCount }));

    // Group by day
    const dayMap = new Map<string, DayGroup>();
    for (const slot of openSlots) {
      const d = new Date(slot.meeting_time);
      const dayLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      const timeLabel = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      if (!dayMap.has(dayLabel)) dayMap.set(dayLabel, { label: dayLabel, slots: [] });
      dayMap.get(dayLabel)!.slots.push({ meeting_time: slot.meeting_time, timeLabel, openCount: slot.openCount });
    }

    setDays([...dayMap.values()]);
    // Drop a stale selection: if the time we had picked is no longer open
    // (freed/re-taken elsewhere, or a restored-from-cache render), clear it so
    // we can't try to book a slot that isn't actually available anymore.
    const openKeys = new Set(openSlots.map((s) => s.meeting_time));
    setSelected((cur) => (cur && openKeys.has(cur) ? cur : null));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const supabase = createClient();

    const loadPerson = async () => {
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase
          .from("members")
          .select("preferred_firstname, lastname, interests")
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
        avatarUrl: null,
        interests: profile?.interests ?? null,
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

    // One chat per person: bail if the user already has an upcoming booking
    // with this member (guards against a stale card or direct navigation).
    const { data: existing } = await supabase
      .from("coffee_chats")
      .select("id")
      .eq("member_id", id)
      .eq("applicant_id", user.id)
      .gte("meeting_time", new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (existing) {
      setError("You already have a coffee chat booked with this person.");
      setBooking(false);
      return;
    }

    // Grab one still-open row for this slot
    const { data: openRow } = await supabase
      .from("coffee_chats")
      .select("id")
      .eq("member_id", id)
      .eq("meeting_time", selected)
      .is("applicant_id", null)
      .limit(1)
      .maybeSingle();

    if (!openRow) {
      setError("That time was just taken. Please pick another.");
      await loadSlots();
      setSelected(null);
      setBooking(false);
      return;
    }

    // Atomic claim: only succeeds if the row is still unclaimed.
    const { data: claimed } = await supabase
      .from("coffee_chats")
      .update({ applicant_id: user.id })
      .eq("id", openRow.id)
      .is("applicant_id", null)
      .select();

    if (!claimed || claimed.length === 0) {
      setError("That time was just taken. Please pick another.");
      await loadSlots();
      setSelected(null);
      setBooking(false);
      return;
    }

    // Reset transient state before leaving. Next keeps this client page alive
    // in its Router Cache (cacheComponents), so if it's reused on a later visit
    // without these resets the button comes back stuck on "Booking…".
    setBooking(false);
    setSelected(null);
    // Invalidate the Router Cache so the list — and this page on a later visit —
    // remount and refetch instead of reusing a stale cached instance.
    router.refresh();
    router.push("/apply/coffee-chat");
  };

  const initials = person?.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "";

  return (
    <div className="w-full max-w-2xl mx-auto p-6 flex flex-col gap-8">
      <Link href="/apply/coffee-chat" className="text-sm text-muted-foreground hover:underline">
        ← Back
      </Link>

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
            <span className="font-semibold">{person.name}</span>
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
          <p className="text-sm text-muted-foreground">Loading availability…</p>
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
                      className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
                        isSelected
                          ? "bg-foreground text-background border-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      {slot.timeLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {days.length > 0 && (
        <div className="flex flex-col gap-2">
          {selected && (
            <p className="text-sm text-muted-foreground">
              Selected:{" "}
              <span className="font-medium text-foreground">
                {new Date(selected).toLocaleString("en-US", {
                  weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                })}
              </span>
            </p>
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
  );
}
