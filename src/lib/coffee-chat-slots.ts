// Pure helpers for turning raw coffee_chats seat rows into bookable slots.
//
// Availability is stored one row per seat: an open slot is one or more rows at
// the same meeting_time with applicant_id null; a claimed seat has applicant_id
// set. These functions bucket seat rows by meeting_time so the booking UI can
// show open count, capacity, and who's already booked — kept side-effect-free
// so they can be unit-tested without a database or a browser.

export type SeatRow = {
  meeting_time: string;
  applicant_id: string | null;
  duration_minutes: number;
};

export type SlotAttendee = { user_id: string; name: string };

export type OpenSlot = {
  meeting_time: string; // canonical ISO key
  duration_minutes: number;
  openCount: number; // unclaimed seats
  capacity: number; // total seats
  filled: number; // claimed seats
  attendees: SlotAttendee[];
};

export type SlotView = OpenSlot & { timeLabel: string };
export type DayGroup = { label: string; slots: SlotView[] };

// Bucket seat rows by meeting_time and return only slots that still have at
// least one open seat. `resolveName` maps a claimed applicant_id to a display
// name (defaults to "Member"). Rows are keyed by their canonical ISO string so
// equivalent timestamps collapse together; duration is taken from the first row
// seen for a time. Pass `includeFullyBooked` to also return slots whose seats
// are all claimed (openCount 0) — used by the read-only availability overview,
// which shows fully-booked times too (dimmed) rather than hiding them.
export function bucketOpenSlots(
  rows: SeatRow[],
  resolveName: (userId: string) => string = () => "Member",
  includeFullyBooked = false,
): OpenSlot[] {
  const openMap = new Map<string, number>();
  const capacityMap = new Map<string, number>();
  const durationMap = new Map<string, number>();
  const filledIdsMap = new Map<string, string[]>();

  for (const r of rows) {
    const key = new Date(r.meeting_time).toISOString();
    if (!openMap.has(key)) openMap.set(key, 0);
    if (!durationMap.has(key)) durationMap.set(key, r.duration_minutes);
    capacityMap.set(key, (capacityMap.get(key) ?? 0) + 1);
    if (r.applicant_id === null) {
      openMap.set(key, openMap.get(key)! + 1);
    } else {
      if (!filledIdsMap.has(key)) filledIdsMap.set(key, []);
      filledIdsMap.get(key)!.push(r.applicant_id);
    }
  }

  return [...openMap.entries()]
    .filter(([, count]) => includeFullyBooked || count > 0)
    .map(([meeting_time, openCount]) => {
      const capacity = capacityMap.get(meeting_time) ?? openCount;
      return {
        meeting_time,
        duration_minutes: durationMap.get(meeting_time) ?? 30,
        openCount,
        capacity,
        filled: capacity - openCount,
        attendees: (filledIdsMap.get(meeting_time) ?? []).map((uid) => ({
          user_id: uid,
          name: resolveName(uid),
        })),
      };
    });
}

// Group open slots into day buckets with human labels, preserving input order
// within each day. Uses en-US locale labels like the booking page.
export function groupSlotsByDay(slots: OpenSlot[]): DayGroup[] {
  const dayMap = new Map<string, DayGroup>();
  for (const slot of slots) {
    const d = new Date(slot.meeting_time);
    const dayLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    const timeLabel = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (!dayMap.has(dayLabel)) dayMap.set(dayLabel, { label: dayLabel, slots: [] });
    dayMap.get(dayLabel)!.slots.push({ ...slot, timeLabel });
  }
  return [...dayMap.values()];
}

// Keep the current selection only if it's still an open slot. A slot that was
// freed/re-taken elsewhere, or a restored-from-cache render, drops the stale
// selection so we can't try to book a time that isn't actually available.
export function keepSelectionIfOpen(selected: string | null, slots: OpenSlot[]): string | null {
  if (!selected) return null;
  const openKeys = new Set(slots.map((s) => s.meeting_time));
  return openKeys.has(selected) ? selected : null;
}

// From a flat list of seat rows (across many hosts), the set of member_ids that
// still have at least one open seat — used to mark a host as bookable.
export function bookableMemberIds(
  rows: { member_id: string; applicant_id: string | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) if (r.applicant_id === null) ids.add(r.member_id);
  return ids;
}
