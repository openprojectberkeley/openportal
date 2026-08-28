import { describe, it, expect } from "vitest";
import {
  bucketOpenSlots,
  groupSlotsByDay,
  keepSelectionIfOpen,
  bookableMemberIds,
  type SeatRow,
} from "@/lib/coffee-chat-slots";

const T1 = "2026-08-27T15:00:00.000Z";
const T2 = "2026-08-27T16:00:00.000Z";
const T3 = "2026-08-28T15:00:00.000Z";

describe("bucketOpenSlots", () => {
  it("counts open, capacity, and filled per meeting_time", () => {
    const rows: SeatRow[] = [
      { meeting_time: T1, applicant_id: null, duration_minutes: 30 },
      { meeting_time: T1, applicant_id: "u1", duration_minutes: 30 },
      { meeting_time: T1, applicant_id: null, duration_minutes: 30 },
    ];
    const [slot] = bucketOpenSlots(rows);
    expect(slot.capacity).toBe(3);
    expect(slot.openCount).toBe(2);
    expect(slot.filled).toBe(1);
    expect(slot.duration_minutes).toBe(30);
  });

  it("hides a fully-booked slot (no open seats)", () => {
    const rows: SeatRow[] = [
      { meeting_time: T1, applicant_id: "u1", duration_minutes: 20 },
      { meeting_time: T1, applicant_id: "u2", duration_minutes: 20 },
    ];
    expect(bucketOpenSlots(rows)).toHaveLength(0);
  });

  it("resolves attendee names via the resolver, defaulting to Member", () => {
    const rows: SeatRow[] = [
      { meeting_time: T1, applicant_id: "u1", duration_minutes: 30 },
      { meeting_time: T1, applicant_id: "u2", duration_minutes: 30 },
      { meeting_time: T1, applicant_id: null, duration_minutes: 30 },
    ];
    const [slot] = bucketOpenSlots(rows, (id) => (id === "u1" ? "Ada" : ""));
    // resolver returning "" for u2 still yields whatever it returns; only a
    // missing resolver call falls back to "Member".
    expect(slot.attendees.map((a) => a.name)).toEqual(["Ada", ""]);
    const [slotDefault] = bucketOpenSlots(rows);
    expect(slotDefault.attendees.every((a) => a.name === "Member")).toBe(true);
  });

  it("collapses equivalent timestamps to one canonical ISO key", () => {
    const rows: SeatRow[] = [
      { meeting_time: "2026-08-27T15:00:00Z", applicant_id: null, duration_minutes: 15 },
      { meeting_time: "2026-08-27T15:00:00.000Z", applicant_id: null, duration_minutes: 15 },
    ];
    const slots = bucketOpenSlots(rows);
    expect(slots).toHaveLength(1);
    expect(slots[0].capacity).toBe(2);
  });

  it("keeps distinct times separate and takes duration from the first row seen", () => {
    const rows: SeatRow[] = [
      { meeting_time: T1, applicant_id: null, duration_minutes: 15 },
      { meeting_time: T2, applicant_id: null, duration_minutes: 30 },
    ];
    const slots = bucketOpenSlots(rows);
    expect(slots).toHaveLength(2);
    expect(slots.find((s) => s.meeting_time === T1)!.duration_minutes).toBe(15);
  });
});

describe("groupSlotsByDay", () => {
  it("groups slots on the same day and splits across days", () => {
    const slots = bucketOpenSlots([
      { meeting_time: T1, applicant_id: null, duration_minutes: 30 },
      { meeting_time: T2, applicant_id: null, duration_minutes: 30 },
      { meeting_time: T3, applicant_id: null, duration_minutes: 30 },
    ]);
    const days = groupSlotsByDay(slots);
    expect(days).toHaveLength(2);
    expect(days[0].slots).toHaveLength(2);
    expect(days[1].slots).toHaveLength(1);
    expect(days[0].slots[0].timeLabel).toMatch(/\d/);
  });
});

describe("keepSelectionIfOpen", () => {
  const slots = bucketOpenSlots([{ meeting_time: T1, applicant_id: null, duration_minutes: 30 }]);
  it("keeps a still-open selection", () => {
    expect(keepSelectionIfOpen(T1, slots)).toBe(T1);
  });
  it("clears a selection that is no longer open", () => {
    expect(keepSelectionIfOpen(T2, slots)).toBeNull();
  });
  it("returns null when nothing is selected", () => {
    expect(keepSelectionIfOpen(null, slots)).toBeNull();
  });
});

describe("bookableMemberIds", () => {
  it("includes only members with at least one open seat", () => {
    const ids = bookableMemberIds([
      { member_id: "a", applicant_id: null },
      { member_id: "b", applicant_id: "u1" },
      { member_id: "c", applicant_id: null },
      { member_id: "c", applicant_id: "u2" },
    ]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(false);
    expect(ids.has("c")).toBe(true);
    expect(ids.size).toBe(2);
  });
});
