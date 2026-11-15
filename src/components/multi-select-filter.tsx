"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterOption = {
  key: string;
  label: string;
  /** Swatch colour. Omit for an option with no identity colour. */
  color?: string | null;
};

type Props = {
  /** The dimension being filtered — "Type", "Portal". Prefixes the trigger. */
  label: string;
  options: FilterOption[];
  /** Empty = everything shown. The control reads that as "All". */
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
  className?: string;
  align?: "start" | "end";
};

/**
 * A multi-select filter dropdown.
 *
 * The trigger carries its own dimension label ("Type · All"), so two of these
 * side by side are unambiguous without separate headings — which is what the
 * chip rows needed and what made them read as one wrapped row.
 *
 * An empty selection means "all", rather than every box being checked: it keeps
 * the default state a single, obvious thing and means clearing is one click.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onToggle,
  onClear,
  className,
  align = "start",
}: Props) {
  // Past ~8 options (portals grow with projects) the menu gets a search box.
  const searchable = options.length > 8;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const count = selected.size;
  const summary =
    count === 0
      ? "All"
      : count === 1
        ? options.find((o) => selected.has(o.key))?.label ?? "1 selected"
        : `${count} selected`;

  return (
    <DropdownMenu onOpenChange={(o) => { if (!o) setQuery(""); }}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Filter by ${label.toLowerCase()}`}
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <span className="shrink-0 text-muted-foreground">{label}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left font-medium",
              count === 0 ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {summary}
          </span>
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        {searchable && (
          <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5">
            <Search className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Keep typing in the box: Radix menus otherwise treat letters as
              // typeahead and move focus to a matching item.
              onKeyDown={(e) => {
                // Enter picks the first match (highlighted below while typing).
                if (e.key === "Enter" && q && shown[0]) {
                  e.preventDefault();
                  onToggle(shown[0].key);
                  return;
                }
                if (e.key !== "ArrowDown" && e.key !== "Escape") e.stopPropagation();
              }}
              placeholder={`Search ${label.toLowerCase()}s…`}
              aria-label={`Search ${label.toLowerCase()}s`}
              className="h-7 w-full border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onClear();
          }}
          className={cn("text-xs", count === 0 && "font-medium")}
        >
          All {label.toLowerCase()}s
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>}
        {shown.map((o, i) => (
          <DropdownMenuCheckboxItem
            key={o.key}
            checked={selected.has(o.key)}
            // Keeps the menu open so several can be picked in one pass —
            // the whole point of a multi-select.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(o.key)}
            className={cn("text-xs", q && i === 0 && "bg-accent text-accent-foreground")}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {o.color !== undefined && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: o.color ?? "hsl(var(--muted-foreground))" }}
                  aria-hidden
                />
              )}
              <span className="truncate">{o.label}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
