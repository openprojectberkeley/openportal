import type { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

// The coffee-chat window defaults, kept in sync with the manager page
// (src/app/(app)/manager/coffee-chats/page.tsx). Used when app_settings has no
// window configured yet.
const DEFAULT_RANGE_START = new Date(2026, 7, 1);
const DEFAULT_RANGE_END = new Date(2026, 7, 31);

// Parse a "YYYY-MM-DD" date string as a local date (not UTC), matching the
// manager page's parseLocalDate so window bounds line up across the app.
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Load the app-wide coffee-chat window from app_settings and return it as an
// inclusive-start / exclusive-end ISO pair: [startIso, endExclusiveIso). The
// stored end date is inclusive, so the exclusive bound is end + 1 day — the
// same convention the manager grid uses when reading/editing availability.
export async function loadCoffeeChatWindowBounds(
  supabase: SupabaseClient,
): Promise<{ startIso: string; endExclusiveIso: string }> {
  const { data } = await supabase
    .from("app_settings")
    .select("coffee_chat_start, coffee_chat_end")
    .eq("id", 1)
    .maybeSingle();

  const start = data?.coffee_chat_start ? parseLocalDate(data.coffee_chat_start) : DEFAULT_RANGE_START;
  const end = data?.coffee_chat_end ? parseLocalDate(data.coffee_chat_end) : DEFAULT_RANGE_END;

  return {
    startIso: start.toISOString(),
    endExclusiveIso: addDays(end, 1).toISOString(),
  };
}
