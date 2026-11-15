"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { CodesTableSkeleton } from "@/components/skeletons";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { PersonName } from "@/components/person-profile-provider";
import { optimistic } from "@/lib/optimistic";
import { BackLink } from "@/components/back-link";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 20;

// Unambiguous charset: no 0/O/1/I/L so codes are easy to read aloud. Codes are
// stored (and matched) uppercase, which is what makes claiming case-insensitive.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function randomCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

type CodeRow = {
  id: string;
  code: string;
  created_at: string;
  claimedBy: string | null;
  claimedById: string | null;
};

export default function ManagerInfosessionPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const deletingId: string | null = null; // deletes are optimistic: the row leaves at once

  const load = useCallback(async (uid: string, pageArg: number) => {
    setLoading(true);
    const supabase = createClient();

    const from = pageArg * PAGE_SIZE;
    const { data, count } = await supabase
      .from("infosesh_attendance")
      .select("id, code, created_at, applicant_id", { count: "exact" })
      .eq("member_id", uid)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    // Resolve claimant names in a second query — applicant_id points at auth
    // users, so there's no direct join to members.
    const applicantIds = [
      ...new Set((data ?? []).map((r) => r.applicant_id).filter((id): id is string => id !== null)),
    ];
    const nameMap = new Map<string, string>();
    if (applicantIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname")
        .in("user_id", applicantIds);
      for (const m of members ?? []) {
        nameMap.set(m.user_id, [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Unknown");
      }
    }

    setRows(
      (data ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        created_at: r.created_at,
        claimedBy: r.applicant_id ? nameMap.get(r.applicant_id) ?? "Unknown" : null,
        claimedById: r.applicant_id,
      })),
    );
    setTotal(count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      load(user.id, 0);
    });
  }, [load]);

  const goToPage = (p: number) => {
    if (!userId) return;
    setPage(p);
    load(userId, p);
  };

  const handleGenerate = async () => {
    if (!userId) return;
    setGenerating(true);
    setGenError(null);
    setCopiedCode(null);

    const supabase = createClient();

    // The `code` column is UNIQUE; on the rare collision (23505) just retry.
    let created: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const { error } = await supabase
        .from("infosesh_attendance")
        .insert({ code, member_id: userId, applicant_id: null });

      if (!error) {
        created = code;
        break;
      }
      if (error.code !== "23505") {
        setGenError(error.message);
        setGenerating(false);
        return;
      }
    }

    if (!created) {
      setGenError("Couldn't generate a unique code. Please try again.");
      setGenerating(false);
      return;
    }

    setNewCode(created);
    setPage(0);
    await load(userId, 0);
    setGenerating(false);
  };

  const handleDelete = async (id: string) => {
    if (!userId) return;
    const row = rows.find((r) => r.id === id);

    const message = row?.claimedBy
      ? `Delete code ${row.code}? ${row.claimedBy} has already checked in with it — this removes their attendance record. This can't be undone.`
      : `Delete code ${row?.code ?? "this code"}? This can't be undone.`;
    if (!window.confirm(message)) return;

    // The row leaves the table at once; the delete runs behind it and the
    // page reloads once it lands. A refusal puts the row back.
    const supabase = createClient();
    const rowsBefore = rows;
    void optimistic({
      label: "code deletion",
      key: `infosesh-code:${id}`,
      apply: () => {
        setRows((prev) => prev.filter((r) => r.id !== id));
        // Clear the highlighted "new code" box if it's the one being deleted.
        if (row && newCode === row.code) {
          setNewCode(null);
          setCopiedCode(null);
        }
      },
      rollback: () => setRows(rowsBefore),
      commit: () => supabase.from("infosesh_attendance").delete().eq("id", id).eq("member_id", userId).select("id"),
      requireRows: true,
      onCommitted: () => {
        // If we just deleted the last row on this page, step back a page.
        const nextPage = rowsBefore.length === 1 && page > 0 ? page - 1 : page;
        setPage(nextPage);
        void load(userId, nextPage);
      },
      onFailed: (message) => setGenError(message),
    });
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } catch {
      // Clipboard unavailable (non-secure context) — nothing to do.
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <BackLink href="/manager" label="Manager" />
        <h1 className="text-2xl font-bold tracking-tight">Infosession Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Generate a code, then read it out to an applicant so they can record their attendance.
        </p>
      </div>

      {/* Generate */}
      <div className="flex flex-col gap-4">
        <button
          onClick={handleGenerate}
          disabled={generating || !userId}
          className="w-full sm:w-auto self-start rounded-md bg-foreground text-background px-4 py-2.5 text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-30"
        >
          {generating ? "Generating…" : "Generate new code"}
        </button>

        {newCode && (
          <button
            type="button"
            onClick={() => copyCode(newCode)}
            title="Click to copy"
            className="group relative self-start flex items-center gap-3 rounded-xl border px-5 py-3 hover:bg-accent transition-colors"
          >
            <span className="font-mono text-2xl font-bold tracking-[0.3em]">{newCode}</span>
            <span className="text-xs text-muted-foreground">{copiedCode === newCode ? "Copied!" : "Click to copy"}</span>
          </button>
        )}

        {genError && <p className="text-sm text-red-500">{genError}</p>}
      </div>

      {/* Your codes */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your codes</h2>
          {total > 0 && <span className="text-xs text-muted-foreground tabular-nums">{total} total</span>}
        </div>

        {loading ? (
          <CodesTableSkeleton />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No codes yet. Generate one above.</p>
        ) : (
          <>
            <ScrollArea orientation="horizontal" className="border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 font-medium">Claimed by</th>
                    <th className="px-4 py-2.5 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => copyCode(r.code)}
                          title="Click to copy"
                          className="font-mono font-medium tracking-wider hover:underline"
                        >
                          {r.code}
                        </button>
                        {copiedCode === r.code && (
                          <span className="ml-2 text-xs text-muted-foreground">Copied!</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("en-US", {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.claimedBy ? (
                          <PersonName userId={r.claimedById} name={r.claimedBy} className="font-medium" />
                        ) : (
                          <span className="text-muted-foreground">Unclaimed</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          disabled={deletingId === r.id}
                          title="Delete code"
                          aria-label={`Delete code ${r.code}`}
                          className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"
                        >
                          {deletingId === r.id ? (
                            <span className="text-xs">Deleting…</span>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M3 6h18" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 0}
                  aria-label="Previous page"
                  className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-accent transition-colors disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page + 1 >= totalPages}
                  aria-label="Next page"
                  className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-accent transition-colors disabled:opacity-30"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
