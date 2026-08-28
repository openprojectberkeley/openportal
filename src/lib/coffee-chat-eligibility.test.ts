import { describe, it, expect } from "vitest";
import { bookingRejectionReason, isBookable } from "@/lib/coffee-chat-eligibility";
import { COFFEE_CHAT_MIN_NOTICE_MS } from "@/lib/coffee-chat-window";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const base = {
  memberId: "host",
  applicantId: "guest",
  now: NOW,
  windowStartIso: "2026-08-26T00:00:00.000Z",
  windowEndExclusiveIso: "2026-09-06T00:00:00.000Z",
};

// A time comfortably past the 6h notice and inside the window.
const OK_TIME = new Date(NOW.getTime() + COFFEE_CHAT_MIN_NOTICE_MS + 60 * 60 * 1000).toISOString();

describe("bookingRejectionReason", () => {
  it("allows a valid future in-window booking", () => {
    expect(bookingRejectionReason({ ...base, meetingTime: OK_TIME })).toBeNull();
    expect(isBookable({ ...base, meetingTime: OK_TIME })).toBe(true);
  });

  it("rejects booking yourself", () => {
    expect(
      bookingRejectionReason({ ...base, applicantId: "host", meetingTime: OK_TIME }),
    ).toBe("self_book");
  });

  it("rejects a slot inside the 6-hour minimum-notice window", () => {
    const soon = new Date(NOW.getTime() + COFFEE_CHAT_MIN_NOTICE_MS - 1000).toISOString();
    expect(bookingRejectionReason({ ...base, meetingTime: soon })).toBe("too_soon");
  });

  it("rejects a past slot as too_soon (notice check subsumes it)", () => {
    const past = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(bookingRejectionReason({ ...base, meetingTime: past })).toBe("too_soon");
  });

  it("rejects a slot before the window start", () => {
    // Far enough ahead of NOW to clear the notice, but before window start —
    // move NOW earlier so an in-notice-cleared time still precedes the window.
    const earlyNow = new Date("2026-08-20T00:00:00.000Z");
    const beforeWindow = new Date(earlyNow.getTime() + COFFEE_CHAT_MIN_NOTICE_MS + 1000).toISOString();
    expect(
      bookingRejectionReason({ ...base, now: earlyNow, meetingTime: beforeWindow }),
    ).toBe("past_or_out_of_window");
  });

  it("rejects a slot at or after the exclusive window end", () => {
    expect(
      bookingRejectionReason({ ...base, meetingTime: base.windowEndExclusiveIso }),
    ).toBe("past_or_out_of_window");
  });

  it("rejects a second upcoming chat with the same host", () => {
    expect(
      bookingRejectionReason({ ...base, meetingTime: OK_TIME, hasUpcomingWithHost: true }),
    ).toBe("already_booked");
  });

  it("applies rules in RPC order: self_book before too_soon", () => {
    const past = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(
      bookingRejectionReason({ ...base, applicantId: "host", meetingTime: past }),
    ).toBe("self_book");
  });

  it("skips the window check when bounds are omitted", () => {
    expect(
      bookingRejectionReason({
        memberId: "host",
        applicantId: "guest",
        now: NOW,
        meetingTime: OK_TIME,
      }),
    ).toBeNull();
  });
});
