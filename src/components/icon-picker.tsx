"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Curated emoji set for portal icons — no emoji library needed.
const PORTAL_EMOJIS = [
  "🚪", "📁", "💻", "🎨", "📣", "🤝", "📊", "🧠",
  "🚀", "⚙️", "📅", "🎯", "🏆", "💡", "🔧", "📌",
  "🌐", "📝", "🎓", "⭐", "🔬", "🎤", "📷", "🎬",
  "🏗️", "🧩", "📚", "✏️", "🗂️", "💬", "🔔", "🧭",
  "🏅", "🎟️", "🍕", "☕", "🎵", "🕹️", "🌱", "🔒",
  "📈", "🛠️", "🧪", "🗓️", "🤖", "🧵", "🏦", "🎉",
];

type Props = {
  value: string;
  onChange: (v: string) => void;
};

export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape. Escape is stopped from bubbling so it
  // dismisses the picker rather than the enclosing Dialog.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setAdding(false);
    setCustom("");
    setCustomError(null);
  };

  const pick = (emoji: string) => {
    onChange(emoji);
    close();
  };

  const addCustom = () => {
    const trimmed = custom.trim();
    // Lock the custom entry to an actual emoji — reject plain text.
    if (!/\p{Extended_Pictographic}/u.test(trimmed)) {
      setCustomError("Enter a single emoji.");
      return;
    }
    // Normalize to the first grapheme so multi-codepoint emoji stay intact.
    let emoji = trimmed;
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const first = seg.segment(trimmed)[Symbol.iterator]().next().value;
      if (first) emoji = first.segment;
    }
    onChange(emoji);
    close();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-9 w-full flex items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span className="text-lg leading-none">{value || "🚪"}</span>
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-md border bg-popover p-2 shadow-lg">
          {adding ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Custom emoji</span>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={custom}
                  onChange={(e) => { setCustom(e.target.value); setCustomError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addCustom(); }
                  }}
                  placeholder="Paste an emoji"
                  className="flex-1"
                />
                <Button type="button" size="sm" onClick={addCustom}>Add</Button>
              </div>
              {customError && <p className="text-xs text-red-500">{customError}</p>}
              <button
                type="button"
                onClick={() => { setAdding(false); setCustom(""); }}
                className="text-xs text-muted-foreground hover:text-foreground self-start"
              >
                ← Back
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-8 gap-1">
                {PORTAL_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => pick(emoji)}
                    className={cn(
                      "h-7 w-7 flex items-center justify-center rounded text-lg hover:bg-accent transition-colors",
                      value === emoji && "ring-2 ring-ring",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  aria-label="Add custom emoji"
                  className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="mt-2 flex justify-end border-t pt-2">
                <button
                  type="button"
                  onClick={() => pick("")}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={12} /> None
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
