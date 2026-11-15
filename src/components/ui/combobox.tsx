"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultFilter } from "cmdk";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Searchable pickers built on ui/command (cmdk). Three shapes:
 *
 * - Combobox:      pick one value; the trigger shows it (a searchable <select>).
 * - MultiCombobox: pick many; the picks sit as removable chips in the trigger.
 * - CommandPicker: an action menu; choosing an option fires onSelect (add a
 *                  member, add a role) rather than holding a value.
 *
 * Inside a Dialog they portal into the dialog (found from the trigger on
 * open) so the list stays in its focus scope and pointer-events region;
 * `container` overrides that.
 */

/** The popover portal target: an explicit container, else the trigger's dialog. */
export function useAutoContainer(explicit?: HTMLElement | null) {
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const [found, setFound] = React.useState<HTMLElement | null>(null);
  const resolve = React.useCallback(() => {
    setFound(triggerRef.current?.closest<HTMLElement>("[role='dialog']") ?? null);
  }, []);
  return { triggerRef, container: explicit ?? found, resolve };
}

export type ComboOption = {
  value: string;
  label: string;
  /** Extra search terms (an email, a family name, a role). */
  keywords?: string[];
  /** Options with a group are listed under that heading, in first-seen order. */
  group?: string;
  /** Muted text after the label. */
  hint?: React.ReactNode;
  /** Leading visual (swatch, icon, avatar). */
  icon?: React.ReactNode;
  disabled?: boolean;
};

type ListProps = {
  options: ComboOption[];
  isSelected?: (value: string) => boolean;
  onPick: (value: string) => void;
  searchPlaceholder?: string;
  emptyText?: React.ReactNode;
  /** Rendered above the list (e.g. filter chips). */
  header?: React.ReactNode;
  /** Rendered after the options (e.g. a "create" action). */
  footer?: React.ReactNode;
  /**
   * Free entry: when the typed text isn't already an option, offer
   * `Add "<text>"` and call this with it. Enter on the input picks it too.
   */
  onCreate?: (text: string) => void;
};

function groupOptions(options: ComboOption[]): [string | undefined, ComboOption[]][] {
  const groups = new Map<string | undefined, ComboOption[]>();
  for (const o of options) {
    const list = groups.get(o.group);
    if (list) list.push(o);
    else groups.set(o.group, [o]);
  }
  return [...groups.entries()];
}

/** The searchable list itself, for embedding in a popover or a dialog. */
export function ComboList({
  options,
  isSelected,
  onPick,
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  header,
  footer,
  onCreate,
}: ListProps) {
  const [search, setSearch] = React.useState("");
  const typed = search.trim();
  const canCreate =
    !!onCreate && typed !== "" && !options.some((o) => o.label.toLowerCase() === typed.toLowerCase());
  return (
    // cmdk highlights the first item after every keystroke, so Enter picks
    // the best match. The "Add" item is scored just above zero so it always
    // sorts after real matches (a zero score would hide its group).
    <Command filter={(value, query, keywords) => (value.startsWith("__create__") ? 1e-6 : defaultFilter(value, query, keywords))}>
      <CommandInput placeholder={searchPlaceholder} autoFocus value={search} onValueChange={setSearch} />
      {header}
      <CommandList>
        {!canCreate && <CommandEmpty>{emptyText}</CommandEmpty>}
        {groupOptions(options).map(([group, items]) => (
          <CommandGroup key={group ?? "_"} heading={group}>
            {items.map((o) => (
              <CommandItem
                key={o.value}
                // cmdk filters on `value`; keep it unique and searchable.
                value={`${o.label} ${o.value}`}
                keywords={o.keywords}
                disabled={o.disabled}
                onSelect={() => onPick(o.value)}
              >
                {isSelected && (
                  <Check className={cn("text-foreground", isSelected(o.value) ? "opacity-100" : "opacity-0")} />
                )}
                {o.icon}
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{o.hint}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {canCreate && (
          // Its own trailing group, so a real match is always the default.
          // forceMount: offered while the text is new, whatever the filter says.
          <CommandGroup>
            <CommandItem
              forceMount
              value={`__create__${typed}`}
              onSelect={() => {
                onCreate!(typed);
                setSearch("");
              }}
            >
              <span className="text-muted-foreground">Add</span>
              <span className="truncate font-medium">&ldquo;{typed}&rdquo;</span>
            </CommandItem>
          </CommandGroup>
        )}
        {footer}
      </CommandList>
    </Command>
  );
}

const TRIGGER =
  "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-left text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type Shared = {
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: React.ReactNode;
  container?: HTMLElement | null;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  "aria-label"?: string;
};

/** Pick one. A searchable replacement for <select> and single-choice menus. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder,
  emptyText,
  container,
  disabled,
  className,
  contentClassName,
  align = "start",
  renderValue,
  "aria-label": ariaLabel,
}: Shared & {
  value: string | null;
  onChange: (value: string) => void;
  /** Custom rendering of the chosen option inside the trigger. */
  renderValue?: (option: ComboOption) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const { triggerRef, container: portalTo, resolve } = useAutoContainer(container);
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Popover open={open} onOpenChange={(o) => { if (o) resolve(); setOpen(o); }}>
      <PopoverTrigger asChild ref={triggerRef as React.Ref<HTMLButtonElement>}>
        <button type="button" role="combobox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} className={cn(TRIGGER, className)}>
          <span className={cn("flex min-w-0 items-center gap-2 truncate", !selected && "text-muted-foreground")}>
            {selected ? (renderValue ? renderValue(selected) : <>{selected.icon}<span className="truncate">{selected.label}</span></>) : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent container={portalTo} align={align} className={cn("w-[--radix-popover-trigger-width] min-w-56 p-0", contentClassName)}>
        <ComboList
          options={options}
          isSelected={(v) => v === value}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Pick many. Picks show as removable chips inside the trigger. */
export function MultiCombobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder,
  emptyText,
  container,
  disabled,
  className,
  contentClassName,
  align = "start",
  creatable = false,
  "aria-label": ariaLabel,
}: Shared & {
  value: string[];
  onChange: (value: string[]) => void;
  /** Allow typing new entries (tags) that aren't in `options`. */
  creatable?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const { triggerRef, container: portalTo, resolve } = useAutoContainer(container);
  // Values not in `options` (free entries) still show, labelled as typed.
  const chosen = value.map((v) => options.find((o) => o.value === v) ?? { value: v, label: v });
  const listOptions = [...options, ...chosen.filter((c) => !options.some((o) => o.value === c.value))];
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Popover open={open} onOpenChange={(o) => { if (o) resolve(); setOpen(o); }}>
      <PopoverTrigger asChild ref={triggerRef as React.Ref<HTMLButtonElement>}>
        <div
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(TRIGGER, "cursor-default", disabled && "pointer-events-none opacity-50", className)}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {chosen.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {chosen.map((o) => (
              <span key={o.value} className="inline-flex max-w-full items-center gap-1 rounded-full bg-foreground/10 py-0.5 pl-2 pr-1 text-xs font-medium">
                <span className="truncate">{o.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${o.label}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(o.value);
                  }}
                  className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </div>
      </PopoverTrigger>
      <PopoverContent container={portalTo} align={align} className={cn("w-[--radix-popover-trigger-width] min-w-56 p-0", contentClassName)}>
        <ComboList
          options={listOptions}
          isSelected={(v) => value.includes(v)}
          onPick={toggle}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          onCreate={creatable ? (text) => { if (!value.includes(text)) onChange([...value, text]); } : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * An action menu with search: the child is the trigger, and choosing an option
 * fires onSelect. Closes after a pick unless `keepOpen` (for adding several
 * people in a row).
 */
export function CommandPicker({
  children,
  options,
  onSelect,
  searchPlaceholder,
  emptyText,
  container,
  contentClassName,
  align = "start",
  keepOpen = false,
  header,
  footer,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  options: ComboOption[];
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  emptyText?: React.ReactNode;
  container?: HTMLElement | null;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  keepOpen?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const { triggerRef, container: portalTo, resolve } = useAutoContainer(container);
  return (
    <Popover open={open} onOpenChange={(o) => { if (o) resolve(); setOpen(o); }}>
      <PopoverTrigger asChild ref={triggerRef as React.Ref<HTMLButtonElement>}>{children}</PopoverTrigger>
      <PopoverContent container={portalTo} align={align} className={cn("w-72 p-0", contentClassName)}>
        <ComboList
          options={options}
          onPick={(v) => {
            onSelect(v);
            if (!keepOpen) setOpen(false);
          }}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          header={header}
          footer={footer}
        />
      </PopoverContent>
    </Popover>
  );
}

/** "a, b, c" <-> ["a","b","c"]: tag values stored as one comma-separated column. */
export function splitList(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
export function joinList(items: string[]): string {
  return items.join(", ");
}
