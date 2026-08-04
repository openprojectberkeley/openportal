"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// Preset accent colors. Users can still pick any color via the native swatch.
const PRESETS = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16", "#22C55E",
  "#14B8A6", "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899",
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
};

export function ColorPicker({ value, onChange }: Props) {
  // Local text so partial/invalid typing doesn't get committed upstream.
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  const commitText = (raw: string) => {
    const next = sanitize(raw);
    setText(next === "#" ? "" : next);
    if (next === "#") { onChange(""); return; }
    if (HEX_RE.test(next)) onChange(next);
  };

  const onBlur = () => {
    // Revert an invalid partial back to the last valid value.
    if (text && !HEX_RE.test(text)) setText(value);
  };

  const swatchValue = HEX_RE.test(value) ? value : FALLBACK;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-1">
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={c}
            className={cn(
              "h-7 w-full rounded border transition-transform hover:scale-105",
              value.toUpperCase() === c && "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* Native visual picker — always yields a valid #rrggbb. */}
        <label className="relative h-9 w-9 flex-shrink-0 rounded-md border overflow-hidden cursor-pointer" style={{ backgroundColor: swatchValue }}>
          <input
            type="color"
            value={swatchValue}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Pick a custom color"
          />
        </label>

        <Input
          value={text}
          onChange={(e) => commitText(e.target.value)}
          onBlur={onBlur}
          placeholder="#RRGGBB"
          spellCheck={false}
          className="flex-1 font-mono"
        />

        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear color"
            className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
