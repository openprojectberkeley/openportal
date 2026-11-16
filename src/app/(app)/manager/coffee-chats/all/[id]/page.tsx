"use client";

import { useParams } from "next/navigation";
import { Suspense, useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { loadCoffeeChatWindowBounds } from "@/lib/coffee-chat-window";
import { bucketOpenSlots, groupSlotsByDay, type DayGroup } from "@/lib/coffee-chat-slots";
import { MapPin } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { HostHeader, HostHeaderSkeleton } from "@/components/coffee-host-header";
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
export default function ViewAvailabilityPage() {
  return (
    <Suspense fallback={<ViewAvailabilitySkeleton />}>
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

  useRefreshOnReturn(loadSlots);

  const firstName = person?.name.split(" ")[0] ?? "them";

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <BackLink href="/manager/coffee-chats/all" label="Everyone's availability" />

      <div className="flex flex-col md:flex-row gap-8 md:items-start">
        {/* Left: host header + times (view-only). */}
        <div className="flex flex-col gap-8 md:w-2/3 min-w-0">
          <HostHeader userId={id} host={person} />

          <section className="flex flex-col gap-5">
            <h2 className="text-base font-semibold tracking-tight">Availability</h2>
            {loading ? (
              <ChipDaysSkeleton />
            ) : days.length === 0 ? (
              <p className="text-sm text-muted-foreground">No availability in the current window.</p>
            ) : (
              days.map((day) => (
                <div key={day.label} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-muted-foreground">{day.label}</p>
                  {/* Read-only: flat muted text chips, nothing that looks pressable. */}
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {day.slots.map((slot) => {
                      const full = slot.openCount === 0;
                      return (
                        <div
                          key={slot.meeting_time}
                          className={`flex items-baseline gap-1.5 text-sm ${full ? "opacity-50" : ""}`}
                        >
                          <span className="font-medium">{slot.timeLabel}</span>
                          <span className="text-xs text-muted-foreground">
                            {slot.duration_minutes}m
                            {slot.capacity > 1 && <> · {slot.filled}/{slot.capacity}</>}
                            {full && slot.capacity <= 1 && <> · booked</>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>

        {/* Right: where the host meets (one-third, sticky). View-only. */}
        <aside className="flex flex-col gap-3 md:w-1/3 md:sticky md:top-6 self-start w-full rounded-xl surface p-4">
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
                <span>{firstName} hasn&apos;t set a location yet.</span>
              )}
            </div>
          ) : (
            <LocationSkeleton />
          )}
        </aside>
      </div>
    </div>
  );
}

// ---- loading shapes ---------------------------------------------------------

// Mirrors the flat text chips (not the booking page's tiles), one text-sm line each.
function ChipDaysSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }, (_, d) => (
        <div key={d} className="flex flex-col gap-2" aria-hidden>
          <span className="flex h-5 items-center"><Skeleton className="h-3.5 w-36 rounded-full" /></span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="flex h-5 items-center"><Skeleton className="h-3.5 w-20 rounded-full" /></span>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

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

// Before the route params resolve: the page with nothing fetched yet.
function ViewAvailabilitySkeleton() {
  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <BackLink href="/manager/coffee-chats/all" label="Everyone's availability" />
      <div className="flex flex-col md:flex-row gap-8 md:items-start">
        <div className="flex flex-col gap-8 md:w-2/3 min-w-0">
          <HostHeaderSkeleton />
          <section className="flex flex-col gap-5">
            <h2 className="text-base font-semibold tracking-tight">Availability</h2>
            <ChipDaysSkeleton />
          </section>
        </div>
        <aside className="flex flex-col gap-3 md:w-1/3 md:sticky md:top-6 self-start w-full rounded-xl surface p-4">
          <LocationSkeleton />
        </aside>
      </div>
    </div>
  );
}
