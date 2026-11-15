"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAutoContainer } from "@/components/ui/combobox";
import { MONTHS, parseLocalDate, toDateInputValue } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The calendar's month/year label made clickable: a glass popover with a year
 * stepper, the twelve months, "Today", and a date field for jumping to an
 * exact day. `onPick` gets the 1st of a picked month, or the exact date.
 */
export function MonthYearPicker({
  value,
  onPick,
  children,
  align = "start",
}: {
  value: Date;
  onPick: (date: Date) => void;
  /** The trigger: the period label, rendered as a button. */
  children: React.ReactNode;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value.getFullYear());
  const { triggerRef, container, resolve } = useAutoContainer();

  const pick = (d: Date) => {
    onPick(d);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          resolve();
          setYear(value.getFullYear());
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild ref={triggerRef as React.Ref<HTMLButtonElement>}>
        {children}
      </PopoverTrigger>
      <PopoverContent container={container} align={align} className="w-64 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous year"
              onClick={() => setYear((y) => y - 1)}
              className="rounded p-1 hover:bg-accent"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="font-display text-sm font-semibold tabular-nums">{year}</span>
            <button
              type="button"
              aria-label="Next year"
              onClick={() => setYear((y) => y + 1)}
              className="rounded p-1 hover:bg-accent"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((m, i) => {
              const current = year === value.getFullYear() && i === value.getMonth();
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(new Date(year, i, 1))}
                  aria-current={current ? "date" : undefined}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-xs font-medium",
                    current ? "bg-foreground text-background" : "hover:bg-accent",
                  )}
                >
                  {m.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Go to date"
              defaultValue={toDateInputValue(value)}
              onChange={(e) => {
                const d = parseLocalDate(e.target.value);
                if (d) pick(d);
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => pick(new Date())}
              className="h-8 rounded-md px-2.5 text-xs font-medium hover:bg-accent"
            >
              Today
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
