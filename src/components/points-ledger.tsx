"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LedgerSkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { DEFAULT_ACCENT } from "@/lib/portal-color";
import { formatPoints, type LedgerEntry } from "@/lib/scoring";

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
 */
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

  const voidedCount = entries?.filter((e) => e.voided_at !== null).length ?? 0;
  const showToggle = !readOnly && voidedCount > 0;

  const header = (title || showToggle) && (
    <div className="flex items-center justify-between gap-3">
      {title ? (
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h2>
      ) : (
        <span />
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
  );

  if (entries === null) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <LedgerSkeleton />
      </div>
    );
  }

  const visible = showVoided ? entries : entries.filter((e) => e.voided_at === null);

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
            {visible.map((e) => {
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
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={readOnly ? 6 : 7}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
