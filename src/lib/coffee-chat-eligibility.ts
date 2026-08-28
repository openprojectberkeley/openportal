// Pure predicates mirroring the booking rules enforced by the book_coffee_chat
// RPC (supabase/migrations/0035_coffee_chat_booking_rpc.sql). The database is
// the source of truth for booking — these exist to document the same rules in
// one place and to power fast client-side messaging without a round trip. Keep
// them in sync with the RPC.

import { COFFEE_CHAT_MIN_NOTICE_MS } from "@/lib/coffee-chat-window";

// Rejection reasons, matching the messages the RPC raises so callers can map a
// server error and a local pre-check through the same branch.
export type BookingRejection =
  | "self_book"
  | "too_soon"
  | "past_or_out_of_window"
  | "already_booked";

export type BookingContext = {
  // The host being booked and the applicant doing the booking.
  memberId: string;
  applicantId: string;
  // The slot's meeting_time (ISO or Date) and the moment "now".
  meetingTime: string | Date;
  now?: Date;
  // Booking window bounds as [start, endExclusive) ISO strings (from
  // loadCoffeeChatWindowBounds). Omit to skip the window check.
  windowStartIso?: string;
  windowEndExclusiveIso?: string;
  // Whether the applicant already has an upcoming chat with this host.
  hasUpcomingWithHost?: boolean;
};

// Return the first rule the booking would violate, or null if it's allowed.
// Order matches the RPC: self, minimum notice, window, one-per-person.
export function bookingRejectionReason(ctx: BookingContext): BookingRejection | null {
  const now = ctx.now ?? new Date();
  const meetingMs = new Date(ctx.meetingTime).getTime();

  if (ctx.memberId === ctx.applicantId) return "self_book";

  if (meetingMs - now.getTime() < COFFEE_CHAT_MIN_NOTICE_MS) return "too_soon";

  if (ctx.windowStartIso && meetingMs < new Date(ctx.windowStartIso).getTime()) {
    return "past_or_out_of_window";
  }
  if (ctx.windowEndExclusiveIso && meetingMs >= new Date(ctx.windowEndExclusiveIso).getTime()) {
    return "past_or_out_of_window";
  }

  if (ctx.hasUpcomingWithHost) return "already_booked";

  return null;
}

export function isBookable(ctx: BookingContext): boolean {
  return bookingRejectionReason(ctx) === null;
}
