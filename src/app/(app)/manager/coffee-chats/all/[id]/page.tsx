"use client";

import { useParams } from "next/navigation";
import { Suspense, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { loadCoffeeChatWindowBounds } from "@/lib/coffee-chat-window";
import { bucketOpenSlots, groupSlotsByDay, type DayGroup } from "@/lib/coffee-chat-slots";
import { AvailabilitySkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { MapPin } from "lucide-react";

type PersonInfo = {
  name: string;
  roles: { id: string; role_name: string }[];
  avatarUrl: string | null;
  interests: string | null;
  defaultLocation: string | null;
};

// useParams() reads uncached route data; cacheComponents requires it to sit
// inside a Suspense boundary so the page shell can still prerender.
export default function ViewAvailabilityPage() {
  return (
    <Suspense fallback={null}>
      <ViewAvailabilityInner />
    </Suspense>
  );
}

// Read-only view of one host's coffee-chat availability, for PMs/execs. No
// booking: every slot renders as a static chip (fully-booked ones dimmed).
// Reuses the booking page's data-loading, stripped of all mutation paths.
function ViewAvailabilityInner() {
  const { id } = useParams<{ id: string }>();

  const [person, setPerson] = useState<PersonInfo | null>(null);
  const [days, setDays] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSlots = useCallback(async () => {
    const supabase = createClient();

    // In-window slots from now onward. Unlike booking, there's no 6h
    // minimum-notice floor (nothing is being booked) — lower bound is the later
    // of the window start and now, so the whole upcoming picture shows.
    const { startIso, endExclusiveIso } = await loadCoffeeChatWindowBounds(supabase);
    const nowIso = new Date().toISOString();
    const lowerIso = startIso > nowIso ? startIso : nowIso;

    const { data: rows } = await supabase
      .from("coffee_chats")
      .select("meeting_time, applicant_id, duration_minutes")
      .eq("member_id", id)
      .gte("meeting_time", lowerIso)
      .lt("meeting_time", endExclusiveIso)
      .order("meeting_time", { ascending: true });

    // Bucket seats into slots, keeping fully-booked times too (shown dimmed).
    // Attendee names are intentionally not resolved — this view shows counts
    // only, not who booked other hosts' chats.
    const slots = bucketOpenSlots(rows ?? [], undefined, true);
    setDays(groupSlotsByDay(slots));
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

  useRefreshOnReturn(loadSlots);

  const initials = person?.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "";

  const firstName = person?.name.split(" ")[0] ?? "them";

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-6">
      <Link href="/manager/coffee-chats/all" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>

      <div className="flex flex-col md:flex-row gap-8 md:items-start">
        {/* Left: host header + times (view-only). */}
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
            <h2 className="font-semibold">Availability</h2>
            {loading ? (
              <AvailabilitySkeleton />
            ) : days.length === 0 ? (
              <p className="text-sm text-muted-foreground">No availability in the current window.</p>
            ) : (
              days.map((day) => (
                <div key={day.label} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-muted-foreground">{day.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {day.slots.map((slot) => {
                      const full = slot.openCount === 0;
                      return (
                        <div
                          key={slot.meeting_time}
                          className={`flex flex-col items-center px-4 py-2 rounded-md border text-sm font-medium ${
                            full ? "opacity-50" : ""
                          }`}
                        >
                          {slot.timeLabel}
                          <span className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                            <span>{slot.duration_minutes} min</span>
                            {slot.capacity > 1 && (
                              <>
                                <span className="h-1 w-1 rounded-full bg-current" />
                                <span className="tabular-nums">{slot.filled}/{slot.capacity}</span>
                              </>
                            )}
                            {full && slot.capacity <= 1 && (
                              <>
                                <span className="h-1 w-1 rounded-full bg-current" />
                                <span>booked</span>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: about the host (one-third, sticky). View-only — no booking. */}
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
                  <span className="italic">No location set yet</span>
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
        </div>
      </div>
    </div>
  );
}
