"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

export const PRONOUN_PRESETS = [
  "she/her",
  "he/him",
  "they/them",
  "she/they",
  "he/they",
  "ze/zir",
] as const;

// Sentinel radio value for the "Custom…" item — distinct from any real pronoun
// value and from the empty ("Not specified") option.
const CUSTOM = "__custom__";

const DEFAULT_TRIGGER_CLASS =
  "flex w-full items-center justify-between border bg-transparent rounded-md px-3 py-2 text-sm";
const DEFAULT_INPUT_CLASS = "border bg-transparent rounded-md px-3 py-2 text-sm w-full";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Styling for the dropdown trigger, so callers can match their form's fields. */
  triggerClassName?: string;
  /** Styling for the custom free-text input. */
  inputClassName?: string;
};

// Pronouns picker: a dropdown of common presets plus a "Custom…" option that
// reveals a free-text input. The value stored/emitted is always the raw pronoun
// string (or "" for not specified) — the custom/preset distinction lives only in
// local UI state.
export function PronounsPicker({ value, onChange, triggerClassName, inputClassName }: Props) {
  // Enter custom mode when the incoming value is something other than a preset
  // (e.g. a saved custom value loaded from the DB).
  const [customMode, setCustomMode] = useState(
    value.length > 0 && !PRONOUN_PRESETS.includes(value as (typeof PRONOUN_PRESETS)[number]),
  );

  const triggerClass = triggerClassName ?? DEFAULT_TRIGGER_CLASS;

  const radioValue = customMode ? CUSTOM : value;
  const triggerLabel = customMode
    ? "Custom"
    : value || "Not specified";

  const handleSelect = (next: string) => {
    if (next === CUSTOM) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    onChange(next); // "" (Not specified) or a preset
  };

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={triggerClass}>
            <span className={triggerLabel === "Not specified" ? "text-muted-foreground" : ""}>
              {triggerLabel}
            </span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          <DropdownMenuRadioGroup value={radioValue} onValueChange={handleSelect}>
            <DropdownMenuRadioItem value="">Not specified</DropdownMenuRadioItem>
            {PRONOUN_PRESETS.map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                {p}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value={CUSTOM}>Custom…</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {customMode && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter your pronouns"
          className={inputClassName ?? DEFAULT_INPUT_CLASS}
        />
      )}
    </div>
  );
}
