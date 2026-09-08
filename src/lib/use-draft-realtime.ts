"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useRef } from "react";

// Subscribes to live changes on the draft tables for one period and fires
// `onChange` (debounced) whenever anything moves -- the turn advances, a pick
// is staged/removed, a round is submitted, or the draft is completed/reset.
// Callers treat it as a "something changed, refetch" signal; the change
// payloads themselves aren't trusted for content (RLS still governs what each
// viewer can actually read on the follow-up fetch).
//
// Realtime respects RLS, and /manager is board/exec-only, so a viewer only
// receives events for rows they can read: draft_state / draft_round_projects
// (board/exec, per 0072 + 0076) and draft_picks for projects they can review.
// draft_state changes (turn / completed_at) are the shared signal everyone on
// the page gets, which is enough to keep the whole panel in sync.
export function useDraftRealtime(periodId: string | null, onChange: () => void) {
  // Keep the latest callback in a ref so re-subscribing isn't tied to the
  // caller passing a stable function.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!periodId) return;
    const supabase = createClient();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onChangeRef.current(), 150);
    };

    const channel = supabase
      .channel(`draft:${periodId}`)
      // draft_state is one row per period -- filter to this period.
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_state", filter: `period_id=eq.${periodId}` }, fire)
      // draft_rounds/draft_round_projects/draft_picks don't all carry period_id
      // directly, so subscribe broadly and let the debounced refetch reconcile.
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_round_projects" }, fire)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks" }, fire)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [periodId]);
}
