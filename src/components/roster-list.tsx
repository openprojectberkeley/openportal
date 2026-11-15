"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/overlay-scrollbar";
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
 * its panel, and rows of name · crown toggle · remove. No pills. `rows === null`
 * renders skeleton rows while the roster loads.
 */
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
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (rows && q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows),
    [rows, q],
  );

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
      {shown === null ? (
        <div className="flex flex-col gap-2 py-1">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${60 - i * 8}%` }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{q ? "No matches." : emptyText}</p>
      ) : (
        <ScrollArea className={maxHeight}>
          <div className="flex flex-col pr-2">
            {shown.map((r) => (
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
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
