"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Semester } from "@/lib/scoring";

/**
 * Manage scoring semesters: create, rename, retime, and choose which one is
 * active. Exec-only — every write here is gated by RLS or by an RPC.
 *
 * Activation goes through `set_active_semester` rather than two client updates:
 * at most one semester may be active (a partial unique index, 0103), so
 * clearing and setting from the browser would transiently violate it depending
 * on statement order, and could leave none active if the second call failed.
 */
export function SemestersDialog({
  open,
  onOpenChange,
  semesters,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  semesters: Semester[];
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("semesters").insert({
      name: trimmed,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
    });
    setPending(false);
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "A semester with that name already exists."
          : insertError.message,
      );
      return;
    }
    setName("");
    setStartsOn("");
    setEndsOn("");
    await onChanged();
  };

  const activate = async (id: string) => {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_active_semester", { p_semester_id: id });
    setPending(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await onChanged();
  };

  const remove = async (s: Semester) => {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("semesters").delete().eq("id", s.id);
    setPending(false);
    if (deleteError) {
      // score_entries.semester_id is ON DELETE RESTRICT, so a semester with
      // history can't be deleted — that would silently erase a past scoreboard.
      setError(
        deleteError.code === "23503"
          ? `${s.name} has points logged against it. Deactivate it instead of deleting it.`
          : deleteError.message,
      );
      return;
    }
    await onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Semesters</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Scores are kept per semester. One semester is active at a time, and the scoreboard shows
            it by default.
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="border rounded-lg divide-y">
            {semesters.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{s.name}</span>
                    {s.is_active && (
                      <span className="px-2 py-0.5 rounded-full bg-foreground text-background text-[10px] font-semibold uppercase tracking-wide">
                        Active
                      </span>
                    )}
                  </div>
                  {(s.starts_on || s.ends_on) && (
                    <p className="text-xs text-muted-foreground">
                      {s.starts_on ?? "—"} → {s.ends_on ?? "—"}
                    </p>
                  )}
                </div>
                {!s.is_active && (
                  <button
                    onClick={() => activate(s.id)}
                    disabled={pending}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                  >
                    <Check size={13} /> Make active
                  </button>
                )}
                <button
                  onClick={() => remove(s)}
                  disabled={pending}
                  className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40"
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {semesters.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No semesters yet.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <Label htmlFor="semester-name">New semester</Label>
            <Input
              id="semester-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fall 2026"
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="semester-start" className="text-xs text-muted-foreground">
                  Starts
                </Label>
                <Input
                  id="semester-start"
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="semester-end" className="text-xs text-muted-foreground">
                  Ends
                </Label>
                <Input
                  id="semester-end"
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={create} disabled={pending}>
                <Plus size={14} /> Add semester
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
