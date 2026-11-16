"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { RosterRowsSkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { AdminCrown } from "@/components/admin-crown";

export type RosterRow = {
  id: string;
  name: string;
  /** Crown state: admin, PM, or an admin-tier role mapping. */
  crown: boolean;
  owner?: boolean;
  /** Can't be removed or re-tiered here (e.g. project-derived, owner). */
  locked?: boolean;
  /** Muted note after the name, e.g. "owner" / "via project". */
  note?: string;
};

/**
 * One roster style for every member/role list (admin portals and projects,
 * the portal members modal): a search box, a scrollable list that stays inside
 * its panel, and rows of name · crown toggle · remove. No pills.
 *
 * `rows === null` renders skeleton rows while the roster loads: as many as
 * `expectedCount` (up to a full scroll area), so the panel opens at its
 * largest and only ever shrinks to fit once the real rows arrive.
 */
const ROW_PX = 28;
const MAX_ROWS = 9;
/** The default scroll area's cap (max-h-64): a long roster's skeleton fills it exactly. */
const FULL_PX = 256;

export function RosterList({
  rows,
  label,
  person = true,
  onToggleCrown,
  onRemove,
  crownTitle,
  addControl,
  emptyText = "No members yet.",
  maxHeight = "max-h-64",
  expectedCount,
}: {
  rows: RosterRow[] | null;
  /** Heading, e.g. "Members". */
  label: string;
  /** Names are people (open their profile) rather than plain labels (roles). */
  person?: boolean;
  onToggleCrown?: (row: RosterRow) => void;
  onRemove?: (row: RosterRow) => void;
  crownTitle?: (row: RosterRow) => string;
  /** The add picker/trigger shown beside the heading. */
  addControl?: React.ReactNode;
  emptyText?: string;
  maxHeight?: string;
  /** How many rows are coming (e.g. a member_count), to size the skeleton. */
  expectedCount?: number;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // Owner first, then admins/PMs (crowned), then everyone else; a stable
  // sort, so each group keeps the caller's (alphabetical) order.
  const shown = useMemo(() => {
    if (!rows) return rows;
    const rank = (r: RosterRow) => (r.owner ? 0 : r.crown ? 1 : 2);
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
    return q ? sorted.filter((r) => r.name.toLowerCase().includes(q)) : sorted;
  }, [rows, q]);
  // A block of rows at a time as the list scrolls (see useProgressiveList).
  const { visible: mounted, pendingRows, sentinelRef } = useProgressiveList(shown ?? [], {
    resetKey: `${rows === null}|${q}`,
  });

  // Height: fixed to the skeleton while loading, then animated to the real
  // content's height, then released to auto (so search/add/remove reflow).
  const loading = rows === null;
  const skeletonRows = Math.max(1, Math.min(expectedCount ?? 4, MAX_ROWS));
  const contentRef = useRef<HTMLDivElement>(null);
  const skeletonPx = (expectedCount ?? 0) > MAX_ROWS ? FULL_PX : skeletonRows * ROW_PX;
  const [height, setHeight] = useState<number | "auto">(loading ? skeletonPx : "auto");
  const wasLoading = useRef(loading);
  useLayoutEffect(() => {
    if (loading) {
      wasLoading.current = true;
      setHeight(skeletonPx);
      return;
    }
    if (!wasLoading.current) return;
    wasLoading.current = false;
    const target = contentRef.current?.offsetHeight ?? 0;
    setHeight((prev) => (prev === target ? "auto" : target));
  }, [loading, skeletonPx]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {rows && <span className="text-[10px] text-muted-foreground/60">({rows.length})</span>}
        {addControl}
        {rows && rows.length > 5 && (
          <div className="relative ml-auto w-44">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              aria-label={`Search ${label.toLowerCase()}`}
              className="h-7 pl-7 text-xs"
            />
          </div>
        )}
      </div>
      <div
        style={{ height }}
        onTransitionEnd={(e) => { if (e.target === e.currentTarget && !loading) setHeight("auto"); }}
        className="overflow-hidden transition-[height] duration-3 ease-out-quart motion-reduce:transition-none"
      >
      <div ref={contentRef}>
      {shown === null ? (
        <div aria-hidden className="flex flex-col pr-2 pt-1.5">
          {Array.from({ length: skeletonRows }, (_, i) => (
            <div key={i} className="flex h-7 items-center gap-2">
              <Skeleton className="h-3.5 rounded-full" style={{ width: `${[46, 38, 52, 34, 42, 30, 48, 36, 40][i % 9]}%` }} />
              <span className="flex-1" />
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <span className="w-4" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{q ? "No matches." : emptyText}</p>
      ) : (
        <ScrollArea className={maxHeight}>
          <div className="flex flex-col pr-2 pt-1.5">
            {mounted.map((r) => (
              <div key={r.id} className="flex min-w-0 items-center gap-2 py-1 text-sm">
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  {person ? (
                    <PersonName userId={r.id} name={r.name} className="min-w-0 truncate" />
                  ) : (
                    <span className="min-w-0 truncate">{r.name}</span>
                  )}
                  {r.note && <span className="shrink-0 text-[11px] text-muted-foreground/70">{r.note}</span>}
                </span>
                <span title={crownTitle?.(r)} className="inline-flex">
                  <AdminCrown
                    active={r.crown}
                    owner={r.owner}
                    locked={r.locked}
                    onToggle={!r.locked && onToggleCrown ? () => onToggleCrown(r) : undefined}
                    size={14}
                  />
                </span>
                {/* Remove column always reserved so crowns stay aligned. */}
                {!r.locked && onRemove ? (
                  <button
                    type="button"
                    onClick={() => onRemove(r)}
                    aria-label={`Remove ${r.name}`}
                    className="flex w-4 flex-shrink-0 justify-center text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X size={13} />
                  </button>
                ) : (
                  <span className="w-4 flex-shrink-0" aria-hidden />
                )}
              </div>
            ))}
            {/* Rows still to come: scrolling into them loads them. */}
            <RosterRowsSkeleton rows={pendingRows} rowRef={sentinelRef} />
          </div>
        </ScrollArea>
      )}
      </div>
      </div>
    </div>
  );
}
