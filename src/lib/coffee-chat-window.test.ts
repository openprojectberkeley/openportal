import { describe, it, expect } from "vitest";
import {
  loadCoffeeChatWindowBounds,
  earliestBookableIso,
  COFFEE_CHAT_MIN_NOTICE_MS,
} from "@/lib/coffee-chat-window";

// Minimal stub of the query chain loadCoffeeChatWindowBounds uses:
// supabase.from(...).select(...).eq(...).maybeSingle()
function fakeSupabase(row: { coffee_chat_start: string; coffee_chat_end: string } | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row }),
  };
  return { from: () => chain } as never;
}

// These assertions rely on TZ=UTC (set in vitest.config.ts) so parseLocalDate
// lands on UTC midnight.
describe("loadCoffeeChatWindowBounds", () => {
  it("returns inclusive-start / exclusive-end (end + 1 day) from app_settings", async () => {
    const { startIso, endExclusiveIso } = await loadCoffeeChatWindowBounds(
      fakeSupabase({ coffee_chat_start: "2026-08-26", coffee_chat_end: "2026-09-05" }),
    );
    expect(startIso).toBe("2026-08-26T00:00:00.000Z");
    // End date is inclusive, so the exclusive bound is Sep 6 midnight.
    expect(endExclusiveIso).toBe("2026-09-06T00:00:00.000Z");
  });

  it("falls back to defaults when app_settings has no window", async () => {
    const { startIso, endExclusiveIso } = await loadCoffeeChatWindowBounds(fakeSupabase(null));
    expect(startIso).toBe("2026-08-01T00:00:00.000Z");
    expect(endExclusiveIso).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("earliestBookableIso", () => {
  it("is now + the 6-hour minimum notice", () => {
    const before = Date.now();
    const iso = earliestBookableIso();
    const after = Date.now();
    const ms = new Date(iso).getTime();
    expect(ms).toBeGreaterThanOrEqual(before + COFFEE_CHAT_MIN_NOTICE_MS);
    expect(ms).toBeLessThanOrEqual(after + COFFEE_CHAT_MIN_NOTICE_MS);
  });

  it("has a 6-hour notice constant", () => {
    expect(COFFEE_CHAT_MIN_NOTICE_MS).toBe(6 * 60 * 60 * 1000);
  });
});
