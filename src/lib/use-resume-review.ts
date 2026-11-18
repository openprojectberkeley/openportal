"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { optimistic } from "@/lib/optimistic";
import type { NoteKind, NoteRect } from "@/lib/resume-note-geometry";

export type NoteTarget = { page: number; kind: NoteKind; rects: NoteRect[]; quote: string | null };

export type ResumeNote = NoteTarget & {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

const NOTE_COLUMNS = "id, author_id, page, kind, rects, quote, body, created_at";
const DRAFT_SAVE_DELAY_MS = 600;

/** Notes and the shared overall comment for one review. Pass null for no review. */
export function useResumeReview(reviewId: string | null, canEdit: boolean) {
  const [notes, setNotes] = useState<ResumeNote[] | null>(null);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [draft, setDraftState] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!reviewId) return [];
    const supabase = createClient();
    const { data, error } = await supabase.from("resume_review_notes").select(NOTE_COLUMNS).eq("review_id", reviewId);
    if (error) {
      toast.error("Couldn't load notes.");
      setNotes((current) => current ?? []);
      return null;
    }
    const rows = (data ?? []) as ResumeNote[];
    setNotes(rows);

    const ids = [...new Set(rows.map((n) => n.author_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: people } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname")
        .in("user_id", ids);
      setAuthors(
        Object.fromEntries(
          (people ?? []).map((p) => [p.user_id, `${p.preferred_firstname ?? ""} ${p.lastname ?? ""}`.trim()]),
        ),
      );
    }
    return rows;
  }, [reviewId]);

  useEffect(() => {
    void refresh();
    if (!canEdit || !reviewId) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      userIdRef.current = user?.id ?? null;
      setUserId(user?.id ?? null);
    });
    supabase
      .from("resume_review_drafts")
      .select("body")
      .eq("review_id", reviewId)
      .maybeSingle()
      .then(({ data }) => {
        if (data && pendingDraft.current === null) setDraftState(data.body);
      });

    // Other reviewers share this draft, so pick up their notes on return.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [canEdit, refresh, reviewId]);

  const flushDraft = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const body = pendingDraft.current;
    if (body === null || !reviewId || !userIdRef.current) return;
    pendingDraft.current = null;
    const { error } = await createClient().from("resume_review_drafts").upsert({
      review_id: reviewId,
      body,
      updated_by: userIdRef.current,
      updated_at: new Date().toISOString(),
    });
    if (error) toast.error("Couldn't save your comment.");
  }, [reviewId]);

  useEffect(() => () => void flushDraft(), [flushDraft]);

  const setDraft = (body: string) => {
    setDraftState(body);
    pendingDraft.current = body;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushDraft(), DRAFT_SAVE_DELAY_MS);
  };

  const addNote = (target: NoteTarget, body: string): string => {
    const note: ResumeNote = {
      ...target,
      id: crypto.randomUUID(),
      author_id: userId,
      body,
      created_at: new Date().toISOString(),
    };
    void optimistic({
      label: "note",
      key: `resume-note:${note.id}`,
      apply: () => setNotes((prev) => [...(prev ?? []), note]),
      rollback: () => setNotes((prev) => prev?.filter((n) => n.id !== note.id) ?? prev),
      commit: () => createClient().from("resume_review_notes").insert({ ...note, review_id: reviewId }),
      onCommitted: () => void refresh(),
    });
    return note.id;
  };

  const updateNote = (note: ResumeNote, body: string) => {
    const setBody = (value: string) =>
      setNotes((prev) => prev?.map((n) => (n.id === note.id ? { ...n, body: value } : n)) ?? prev);
    void optimistic({
      label: "note",
      key: `resume-note:${note.id}`,
      apply: () => setBody(body),
      rollback: () => setBody(note.body),
      commit: () => createClient().from("resume_review_notes").update({ body }).eq("id", note.id).select("id"),
      requireRows: true,
    });
  };

  const deleteNote = (note: ResumeNote) => {
    void optimistic({
      label: "note",
      key: `resume-note:${note.id}`,
      apply: () => setNotes((prev) => prev?.filter((n) => n.id !== note.id) ?? prev),
      rollback: () => setNotes((prev) => (prev ? [...prev, note] : prev)),
      commit: () => createClient().from("resume_review_notes").delete().eq("id", note.id).select("id"),
      requireRows: true,
    });
  };

  const send = async (): Promise<boolean> => {
    pendingDraft.current = null;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const { error } = await createClient().rpc("complete_resume_review", {
      p_review_id: reviewId,
      p_feedback: draft,
    });
    if (error) {
      toast.error(/already handled/.test(error.message) ? "This review was already sent." : "Couldn't send feedback.");
      return false;
    }
    return true;
  };

  return { notes, authors, draft, setDraft, addNote, updateNote, deleteNote, send, refresh };
}
