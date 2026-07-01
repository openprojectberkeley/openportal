"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { PLACEHOLDER_PEOPLE, getAvailability, type AvailableDay } from "@/lib/coffee-chat-people";

type PersonInfo = {
  name: string;
  roles: { id: string; role_name: string }[];
  avatarUrl: string | null;
  interests: string | null;
};

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [person, setPerson] = useState<PersonInfo | null>(null);
  const [availability, setAvailability] = useState<AvailableDay[]>([]);
  const [selected, setSelected] = useState<{ label: string; slot: string } | null>(null);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    const index = parseInt(id);
    const isPlaceholder = !isNaN(index) && index >= 0 && index < PLACEHOLDER_PEOPLE.length;

    if (isPlaceholder) {
      const p = PLACEHOLDER_PEOPLE[index];
      setPerson({ name: p.name, roles: p.roles, avatarUrl: p.avatarUrl, interests: p.interests });
      setAvailability(getAvailability(index));
    } else {
      // Real member — availability fetch can be wired up later
      setPerson({ name: "Member", roles: [], avatarUrl: null, interests: null });
      setAvailability(getAvailability(0));
    }
  }, [id]);

  const initials = person?.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "";

  if (booked && selected) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6">
        <div className="flex flex-col gap-4 w-full max-w-sm text-center">
          <div className="text-4xl">✓</div>
          <h1 className="text-2xl font-bold">You're booked!</h1>
          <p className="text-sm text-muted-foreground">
            {selected.label} at {selected.slot} with {person?.name}
          </p>
          <Link href="/apply/coffee-chat" className="text-sm text-muted-foreground hover:underline mt-2">
            ← Back to coffee chats
          </Link>
        </div>
      </div>
    );
  }

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
        {availability.map((day) => (
          <div key={day.label} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">{day.label}</p>
            <div className="flex flex-wrap gap-2">
              {day.slots.map((slot) => {
                const isSelected = selected?.label === day.label && selected?.slot === slot;
                return (
                  <button
                    key={slot}
                    onClick={() => setSelected({ label: day.label, slot })}
                    className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
                      isSelected
                        ? "bg-foreground text-background border-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {selected && (
          <p className="text-sm text-muted-foreground">
            Selected: <span className="font-medium text-foreground">{selected.label} at {selected.slot}</span>
          </p>
        )}
        <button
          disabled={!selected}
          onClick={() => setBooked(true)}
          className="w-full rounded-md bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-30"
        >
          Book Meeting
        </button>
      </div>
    </div>
  );
}
