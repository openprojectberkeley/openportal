"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { LedgerEntry } from "@/lib/scoring";

/**
 * The points audit feed for one semester, newest first.
 *
 * One RPC rather than a PostgREST join: the awarder's display name lives in
 * `members` behind its own RLS and the family comes through `projects`, so the
 * client-side version is two or three extra round trips plus a join to
 * assemble (0100).
 *
 * Voided rows are included — the point of an audit view is that a void stays
 * visible — and the UI filters them behind a toggle.
 */
export function useScoreLedger(semesterId: string | null, limit = 50) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++genRef.current;
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("score_ledger", {
      p_semester_id: semesterId,
      p_limit: limit,
    });

    if (gen !== genRef.current) return;
    if (rpcError) {
      setError("Couldn't load the points log.");
      setEntries([]);
      return;
    }
    setError(null);
    setEntries((data ?? []) as LedgerEntry[]);
  }, [semesterId, limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Voiding is the one in-place change to a row, so patch it locally rather
  // than refetching the whole feed and losing the reader's scroll position.
  const markVoided = useCallback((id: string) => {
    setEntries((prev) =>
      prev?.map((e) => (e.id === id ? { ...e, voided_at: new Date().toISOString() } : e)) ?? prev,
    );
  }, []);

  return { entries, error, reload, markVoided };
}
