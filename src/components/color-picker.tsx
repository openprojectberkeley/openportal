"use client";

import { useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAutoContainer } from "@/components/ui/combobox";
import { readableTextColor } from "@/lib/portal-color";

// Preset accent colors. Users can still pick any color via the native swatch.
// Mid-tone 500s: fine as accents (dots, rails, tints), but they sit near the
// black/white crossover, so surfaces carrying text pass TEXT_BG_PRESETS.
const DEFAULT_PRESETS = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16", "#22C55E",
  "#14B8A6", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899",
];

/**
 * Backgrounds that carry text (announcement banners). Row one is deep, for
 * white text (6–7.6:1); row two is light, for dark text (11–16:1). Both clear
 * WCAG AA with room to spare, and readableTextColor picks the right one.
 */
export const TEXT_BG_PRESETS = [
  "#B91C1C", "#9A3412", "#166534", "#155E75", "#1D4ED8", "#6D28D9",
  "#FCD34D", "#BEF264", "#6EE7B7", "#7DD3FC", "#C4B5FD", "#F9A8D4",
];

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const FALLBACK = "#888888";

// Force a single leading "#", keep only hex digits, cap at 6, uppercase.
function sanitize(raw: string): string {
  const digits = raw.replace(/[^0-9a-fA-F]/g, "").slice(0, 6).toUpperCase();
  return `#${digits}`;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** A colour must stay set (no "No colour" option). */
  required?: boolean;
  /** Swatches to offer (12, laid out 6 per row). Defaults to the accent set. */
  presets?: string[];
  /** Label each swatch "Aa" in its readable text colour, for text surfaces. */
  showTextSample?: boolean;
  className?: string;
};

/**
 * One compact colour control for the whole app: a 36px trigger (swatch + hex
 * + chevron, the same height as the icon picker beside it) that opens a glass
 * popover holding every way to choose: the presets, the native picker, a hex
 * field, and "No colour". Portals into an enclosing dialog automatically.
 */
export function ColorPicker({
  value,
  onChange,
  required = false,
  presets = DEFAULT_PRESETS,
  showTextSample = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const { triggerRef, container, resolve } = useAutoContainer();
  // Local text so partial/invalid typing doesn't get committed upstream.
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  const commitText = (raw: string) => {
    const next = sanitize(raw);
    setText(next === "#" ? "" : next);
    if (next === "#") {
      if (!required) onChange("");
      return;
    }
    if (HEX_RE.test(next)) onChange(next);
  };

  const onBlur = () => {
    // Revert an invalid partial back to the last valid value.
    if (text && !HEX_RE.test(text)) setText(value);
  };

  const valid = HEX_RE.test(value);
  const swatchValue = valid ? value : FALLBACK;

  return (
    <Popover open={open} onOpenChange={(o) => { if (o) resolve(); setOpen(o); }}>
      <PopoverTrigger asChild ref={triggerRef as React.Ref<HTMLButtonElement>}>
        <button
          type="button"
          aria-label={valid ? `Colour ${value}` : "Choose a colour"}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold",
              !valid && "border border-dashed border-foreground/25",
            )}
            style={valid ? { backgroundColor: value, color: readableTextColor(value) } : undefined}
          >
            {showTextSample && valid && "Aa"}
          </span>
          <span className={cn("flex-1 truncate text-left", valid ? "font-mono text-xs" : "text-muted-foreground")}>
            {valid ? value : "No colour"}
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent container={container} align="start" className="w-64 p-3">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-6 gap-1.5">
            {presets.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                aria-label={c}
                aria-pressed={value.toUpperCase() === c}
                className={cn(
                  "flex h-7 w-full items-center justify-center rounded text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  value.toUpperCase() === c && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                )}
                style={{ backgroundColor: c, color: showTextSample ? readableTextColor(c) : undefined }}
              >
                {showTextSample && <span aria-hidden>Aa</span>}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Native visual picker — always yields a valid #rrggbb. */}
            <label
              className="relative h-9 w-9 flex-shrink-0 cursor-pointer overflow-hidden rounded-md border"
              style={{ backgroundColor: swatchValue }}
              title="Custom colour"
            >
              <input
                type="color"
                value={swatchValue}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Pick a custom color"
              />
            </label>
            <Input
              value={text}
              onChange={(e) => commitText(e.target.value)}
              onBlur={onBlur}
              placeholder="#RRGGBB"
              spellCheck={false}
              aria-label="Hex colour"
              className="flex-1 font-mono"
            />
          </div>

          {!required && valid && (
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
            >
              <X size={13} /> No colour
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
