"use client";

// The member half of the exec's add-to-project picker: accounts with NO
// application in play for a period (0096), so the board can draft someone who
// never applied.
//
// Server-side search rather than a fetched list, because the candidate set is
// "every account that didn't apply" -- most of the members table, and most of it
// irrelevant. search_addable_members is exec-gated, returns nothing under two
// characters, and caps at 50 rows; this hook debounces the typing and drops
// results that arrive out of order.
//
// Lives in its own module, and is called from inside ApplicantPickerDialog
// rather than by the board: its state changes on every keystroke, and the board
// renders ~19 columns of un-memoized cards. Owned up there, typing repainted the
// whole board two or three times per character.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Why this account is not already in the draft pool (0098). The picker labels
// each row with it, and add_member_to_draft branches on the same three cases.
export type AddableStatus = null | "draft" | "rejected";

export type AddableMember = {
  user_id: string;
  name: string | null;
  email: string | null;
  //   null       never applied this period
  //   'draft'    started one and never submitted it -- adding submits what they wrote
  //   'rejected' applied and was turned down -- adding reverts that
  app_status: AddableStatus;
};

export const MEMBER_SEARCH_MIN = 2;
const MEMBER_SEARCH_DEBOUNCE_MS = 250;

export function useAddableMembers(periodId: string | null, query: string, enabled: boolean) {
  const [members, setMembers] = useState<AddableMember[] | null>(null);
  const [searching, setSearching] = useState(false);
  const genRef = useRef(0);

  const needle = query.trim();
  const tooShort = needle.length < MEMBER_SEARCH_MIN;

  useEffect(() => {
    // ++ on every run, so a request in flight for older text can never land.
    const gen = ++genRef.current;
    if (!enabled || !periodId || tooShort) {
      setMembers(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const { data, error } = await createClient().rpc("search_addable_members", {
        p_period_id: periodId,
        p_query: needle,
      });
      if (gen !== genRef.current) return;
      setMembers(error ? [] : ((data ?? []) as AddableMember[]));
      setSearching(false);
    }, MEMBER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [periodId, needle, tooShort, enabled]);

  // Lets a caller drop a just-added person out of the list without refetching.
  const forget = useCallback((userId: string) => {
    setMembers((prev) => (prev ? prev.filter((m) => m.user_id !== userId) : prev));
  }, []);

  return { members, searching, tooShort, minChars: MEMBER_SEARCH_MIN, forget };
}
