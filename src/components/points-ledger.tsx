"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LedgerSkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { DEFAULT_ACCENT } from "@/lib/portal-color";
import { formatPoints, ledgerMatches, type LedgerEntry } from "@/lib/scoring";

function formatDay(iso: string): string {
  // `awarded_on` is a DATE, so parse the parts rather than letting Date treat
  // "2026-10-06" as UTC midnight and render the previous day west of GMT.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The points audit feed. A raw table with Tailwind — there's no shadcn table
 * primitive in this app, same as the attendance and codes tables.
 *
 * Voided rows stay in the list, struck through: a void is the only correction
 * mechanism, and the whole point of it over an offsetting row is that the
 * original amount, reason and awarder remain readable. `readOnly` drops the
 * void column so the member-facing scoreboard can render the same feed.
 *
 * Search and paging are both client-side over whatever the caller loaded: the
 * score_ledger RPC takes no offset or query, and a semester's log is small
 * enough (tens of rows, 500 at the RPC's ceiling) that one fetch beats a round
 * trip per page — which also keeps a search over every page instant.
 */
// Enough to scan in one screenful without turning the log into a scroll.
const PAGE_SIZE = 20;

export function PointsLedger({
  entries,
  title,
  readOnly = false,
  onVoided,
  emptyLabel = "No points awarded yet.",
}: {
  entries: LedgerEntry[] | null;
  /**
   * Section heading, rendered inline with the "show voided" toggle. Owned here
   * rather than by the caller so the two share a row instead of stacking.
   */
  title?: string;
  readOnly?: boolean;
  onVoided?: (id: string) => void;
  emptyLabel?: string;
}) {
  const [showVoided, setShowVoided] = useState(false);
  const [voiding, setVoiding] = useState<LedgerEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // Counted over every entry, not the current page or the search hits, so the
  // toggle keeps meaning "voided in this log".
  const voidedCount = entries?.filter((e) => e.voided_at !== null).length ?? 0;
  const showToggle = !readOnly && voidedCount > 0;
  const showSearch = (entries?.length ?? 0) > 0;

  // Back to the first page when the reader changes what they're looking at.
  // Deliberately NOT on `entries`: markVoided hands back a new array on every
  // void, which would throw an exec voiding a row on page 3 back to page 1.
  // The clamp below already covers the list shrinking under them.
  useEffect(() => {
    setPage(0);
  }, [query, showVoided]);

  const header = (title || showToggle || showSearch) && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {title ? (
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h2>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {showSearch && (
          <>
            <Label htmlFor="points-log-search" className="sr-only">
              Search the points log
            </Label>
            <Input
              id="points-log-search"
              type="search"
              placeholder="Search project, family, reason…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-56 text-xs"
            />
          </>
        )}
        {showToggle && (
          <div className="flex items-center gap-2">
            <Label htmlFor="show-voided" className="text-xs text-muted-foreground">
              Show voided ({voidedCount})
            </Label>
            <Switch id="show-voided" checked={showVoided} onCheckedChange={setShowVoided} />
          </div>
        )}
      </div>
    </div>
  );

  if (entries === null) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <LedgerSkeleton />
      </div>
    );
  }

  // Voided filter first (that's what the toggle has always meant), then the
  // search, then the slice.
  const visible = showVoided ? entries : entries.filter((e) => e.voided_at === null);
  const searching = query.trim().length > 0;
  const filtered = searching ? visible.filter((e) => ledgerMatches(e, query)) : visible;

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamped rather than reset, so a void or a semester switch that shortens the
  // list lands the reader on the last page instead of an empty one.
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  const emptyMessage = searching
    ? `No entries match “${query.trim()}”.`
    : showToggle && visible.length === 0
      ? "Every entry in this log is voided. Turn on “Show voided” to see them."
      : emptyLabel;

  const voidEntry = async (entry: LedgerEntry) => {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("void_score_entry", { p_entry_id: entry.id });
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    setError(null);
    onVoided?.(entry.id);
    return true;
  };

  return (
    <div className="flex flex-col gap-2">
      {header}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-semibold border-b">Date</th>
              <th className="px-3 py-2 font-semibold border-b">Project</th>
              <th className="px-3 py-2 font-semibold border-b">Family</th>
              <th className="px-3 py-2 font-semibold border-b text-right">Points</th>
              <th className="px-3 py-2 font-semibold border-b">Reason</th>
              <th className="px-3 py-2 font-semibold border-b">By</th>
              {!readOnly && <th className="px-3 py-2 font-semibold border-b" />}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((e) => {
              const isVoid = e.voided_at !== null;
              return (
                <tr key={e.id} className={isVoid ? "line-through opacity-50" : undefined}>
                  <td className="px-3 py-2 border-b whitespace-nowrap text-muted-foreground">
                    {formatDay(e.awarded_on)}
                  </td>
                  <td className="px-3 py-2 border-b">{e.project_name}</td>
                  <td className="px-3 py-2 border-b whitespace-nowrap">
                    {e.family_id ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: e.family_color || DEFAULT_ACCENT }}
                          aria-hidden
                        />
                        {e.family_name}
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-500 text-xs">No family</span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 border-b text-right tabular-nums font-semibold ${
                      e.points < 0 ? "text-red-600 dark:text-red-400" : ""
                    }`}
                  >
                    {formatPoints(e.points)}
                  </td>
                  <td className="px-3 py-2 border-b max-w-xs">{e.reason}</td>
                  <td className="px-3 py-2 border-b whitespace-nowrap text-muted-foreground">
                    {e.awarded_by ? (
                      <PersonName userId={e.awarded_by} name={e.awarded_by_name ?? "Unknown"} />
                    ) : (
                      "—"
                    )}
                  </td>
                  {!readOnly && (
                    <td className="px-3 py-2 border-b text-right whitespace-nowrap">
                      {isVoid ? (
                        <span className="text-xs text-muted-foreground no-underline">voided</span>
                      ) : (
                        <button
                          onClick={() => setVoiding(e)}
                          className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={readOnly ? 6 : 7}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <nav
          className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
          aria-label="Points log pages"
        >
          <span className="tabular-nums" aria-live="polite">
            Showing {start + 1}–{start + pageRows.length} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={safePage === 0}
              aria-label="Previous page"
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={safePage >= pageCount - 1}
              aria-label="Next page"
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}

      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(o) => { if (!o) setVoiding(null); }}
        title="Void this award?"
        description={
          voiding
            ? `${formatPoints(voiding.points)} for ${voiding.project_name} stops counting toward ${
                voiding.family_name ?? "any family"
              }. The entry stays in the log, struck through.`
            : undefined
        }
        confirmLabel="Void"
        onConfirm={async () => {
          if (!voiding) return false;
          const ok = await voidEntry(voiding);
          if (ok) setVoiding(null);
          return ok;
        }}
      />
    </div>
  );
}
