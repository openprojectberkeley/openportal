// Shared coffee-chat indicator helpers (pure — safe for API routes).

// Coffee-chat progress for an applicant: "done" once any chat is completed,
// "booked" while one is booked but not yet completed, "none" if never booked.
export type CoffeeState = "done" | "booked" | "none";

// Label for the coffee-chat icon hover/aria text. Prefer partner names when
// callers have them; otherwise fall back to the generic status copy.
export function coffeeChatLabel(state: CoffeeState, withNames?: string[] | null): string {
  const names = (withNames ?? []).filter(Boolean);
  if (state === "done") {
    return names.length ? `Coffee chatted with ${names.join(", ")}` : "Completed a coffee chat";
  }
  if (state === "booked") {
    return names.length ? `Coffee chat booked with ${names.join(", ")}` : "Coffee chat booked";
  }
  return "";
}

// For each applicant, the host names that should appear on the coffee icon:
// completed hosts when any chat is done, otherwise booked hosts. Dedupes by
// host id so repeat bookings with the same person appear once.
export function coffeeWithByApplicant(
  chats: { applicant_id: string; member_id: string; complete: boolean }[],
  hostNameById: Record<string, string>,
): Record<string, string[]> {
  const completedIds: Record<string, string[]> = {};
  const bookedIds: Record<string, string[]> = {};
  const done = new Set<string>();

  for (const ch of chats) {
    if (ch.complete) {
      done.add(ch.applicant_id);
      (completedIds[ch.applicant_id] ??= []).push(ch.member_id);
    } else {
      (bookedIds[ch.applicant_id] ??= []).push(ch.member_id);
    }
  }

  const out: Record<string, string[]> = {};
  const applicants = new Set([...Object.keys(completedIds), ...Object.keys(bookedIds)]);
  for (const aid of applicants) {
    const memberIds = done.has(aid) ? completedIds[aid] ?? [] : bookedIds[aid] ?? [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const mid of memberIds) {
      if (seen.has(mid)) continue;
      seen.add(mid);
      const name = hostNameById[mid];
      if (name) names.push(name);
    }
    out[aid] = names;
  }
  return out;
}
