// Rank labels shared by the applications manager list and its analytics views.
// Applicants rank projects 1–7; anything beyond falls back to "Nth choice".
export const RANK_LABELS: Record<number, string> = {
  1: "1st choice", 2: "2nd choice", 3: "3rd choice", 4: "4th choice",
  5: "5th choice", 6: "6th choice", 7: "7th choice",
};

export function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? `${rank}th choice`;
}
