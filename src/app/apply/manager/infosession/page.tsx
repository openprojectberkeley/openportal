"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
        <Link href="/apply/manager" className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <h1 className="text-2xl font-bold">Infosession Attendance</h1>
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
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No codes yet. Generate one above.</p>
        ) : (
          <>
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 font-medium">Claimed by</th>
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
                          <span className="font-medium">{r.claimedBy}</span>
                        ) : (
                          <span className="text-muted-foreground">Unclaimed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 0}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-30"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page + 1 >= totalPages}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
