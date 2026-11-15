"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { CodesTableSkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { optimistic } from "@/lib/optimistic";
import { BackLink } from "@/components/back-link";
import { Check, ChevronLeft, ChevronRight, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { staggerStyle } from "@/lib/motion";
import { useConfirm } from "@/components/ui/use-confirm";

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
  const { ask, dialog: confirmDialog } = useConfirm();
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

  const handleDelete = (id: string) => {
    if (!userId) return;
    const row = rows.find((r) => r.id === id);

    ask({
      title: row?.claimedBy ? `Delete code ${row.code}?` : `Delete code ${row?.code ?? "this code"}?`,
      description: row?.claimedBy
        ? `${row.claimedBy} has already checked in with it; this removes their attendance record. This can't be undone.`
        : "This can't be undone.",
      confirmLabel: "Delete code",
      destructive: true,
      run: () => runDelete(id, row),
    });
  };
  const runDelete = (id: string, row: (typeof rows)[number] | undefined) => {
    if (!userId) return;
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
  const pager = (
    <nav aria-label="Code pages" className="flex items-center gap-2 text-xs text-muted-foreground">
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goToPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        <ChevronLeft size={14} />
      </Button>
      <span className="tabular-nums">{page + 1} / {totalPages}</span>
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goToPage(page + 1)} disabled={page + 1 >= totalPages} aria-label="Next page">
        <ChevronRight size={14} />
      </Button>
    </nav>
  );

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-10">
      {confirmDialog}
      <div className="flex flex-col gap-1">
        <BackLink href="/manager" label="Manager" />
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Infosession attendance</h1>
          <InfoHint label="How codes work">
            Generate a code, then read it out to an applicant so they can record their attendance. Each code works once.
          </InfoHint>
        </div>
      </div>

      {/* Generate: the newest code shows large, click to copy. */}
      <div className="flex flex-wrap items-center gap-4">
        <Button size="lg" onClick={handleGenerate} disabled={generating || !userId}>
          {generating ? "Generating…" : "Generate new code"}
        </Button>
        {newCode && (
          <button
            type="button"
            onClick={() => copyCode(newCode)}
            aria-label={`Copy code ${newCode}`}
            title={newCode}
            className="group flex min-w-0 max-w-full items-center gap-3 rounded-xl surface px-5 py-2.5 animate-pop"
          >
            {/* One line: a long code is cut off; the copy still takes all of it. */}
            <span className="min-w-0 truncate whitespace-nowrap font-mono text-2xl font-bold tracking-[0.3em]">{newCode}</span>
            <span className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground">
              {copiedCode === newCode ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </span>
          </button>
        )}
        {genError && <p className="w-full text-sm text-destructive">{genError}</p>}
      </div>

      {/* Your codes */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">
            Your codes
            {total > 0 && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{total}</span>}
          </h2>
          {totalPages > 1 && pager}
        </div>

        {loading ? (
          <CodesTableSkeleton />
        ) : rows.length === 0 ? (
          <p className="rounded-xl surface px-4 py-8 text-center text-sm text-muted-foreground">No codes yet</p>
        ) : (
          <div className="-mx-4 flex flex-col gap-0.5">
            {rows.map((r, i) => (
              <div
                key={r.id}
                className="group grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-4 rounded-lg px-4 py-2.5 text-sm hover:bg-foreground/[0.03] sm:grid-cols-[minmax(0,9rem)_9rem_minmax(0,1fr)_auto] animate-fade-in-up"
                style={staggerStyle(i)}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => copyCode(r.code)}
                      aria-label={`Copy code ${r.code}`}
                      className="flex min-w-0 max-w-full items-center gap-1.5 justify-self-start font-mono font-medium tracking-wider hover:underline underline-offset-2"
                    >
                      <span className="min-w-0 truncate whitespace-nowrap">{r.code}</span>
                      {copiedCode === r.code && <Check size={13} className="shrink-0 text-success" />}
                    </button>
                  </TooltipTrigger>
                  {/* The full code, even when the cell cuts it off. */}
                  <TooltipContent className="max-w-xs break-all font-mono">
                    {r.code}
                    <span className="ml-2 font-sans text-muted-foreground">{copiedCode === r.code ? "Copied" : "Click to copy"}</span>
                  </TooltipContent>
                </Tooltip>
                <span className="hidden whitespace-nowrap text-muted-foreground sm:block">
                  {new Date(r.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0 truncate">
                  {r.claimedBy ? (
                    <PersonName userId={r.claimedById} name={r.claimedBy} className="font-medium" />
                  ) : (
                    <span className="text-muted-foreground">Unclaimed</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(r.id)}
                  aria-label={`Delete code ${r.code}`}
                  className="h-7 w-7 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
        {!loading && totalPages > 1 && <div className="flex justify-end">{pager}</div>}
      </section>
    </div>
  );
}
