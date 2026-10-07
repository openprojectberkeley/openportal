"use client";

import { ChevronDown } from "lucide-react";
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
  const count = selected.size;
  const summary =
    count === 0
      ? "All"
      : count === 1
        ? options.find((o) => selected.has(o.key))?.label ?? "1 selected"
        : `${count} selected`;

  return (
    <DropdownMenu>
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
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.key}
            checked={selected.has(o.key)}
            // Keeps the menu open so several can be picked in one pass —
            // the whole point of a multi-select.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(o.key)}
            className="text-xs"
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
