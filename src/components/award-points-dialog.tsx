"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { POINT_PRESETS, POINTS_MAX, REASON_MAX, type Semester } from "@/lib/scoring";
import type { FamilyProject } from "@/lib/use-families";
import type { Family } from "@/lib/scoring";

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Award (or deduct) points for one project.
 *
 * Points are awarded to a *project*, never to a family — a family's total is
 * the sum over its projects (0103) — so the picker is a project list annotated
 * with where the points will land. The write goes through the `award_score` RPC
 * because `score_entries` has no insert policy at all: the ledger is
 * append-only by schema, not by convention.
 */
export function AwardPointsDialog({
  open,
  onOpenChange,
  projects,
  families,
  semester,
  onAwarded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: FamilyProject[];
  families: Family[];
  semester: Semester | null;
  onAwarded: () => Promise<void> | void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [magnitude, setMagnitude] = useState("");
  const [negative, setNegative] = useState(false);
  const [reason, setReason] = useState("");
  const [awardedOn, setAwardedOn] = useState(todayLocal());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per opening so a previous award's reason can't be submitted twice.
  useEffect(() => {
    if (!open) return;
    setProjectId(null);
    setMagnitude("");
    setNegative(false);
    setReason("");
    setAwardedOn(todayLocal());
    setError(null);
  }, [open]);

  const familyName = useMemo(() => {
    const byId = new Map(families.map((f) => [f.id, f.name]));
    return (id: string | null) => (id ? byId.get(id) ?? null : null);
  }, [families]);

  // Grouped so exec sees the family a project will score for, with unassigned
  // projects last and flagged — points there count for nobody.
  const ordered = useMemo(() => {
    const assigned = projects.filter((p) => p.family_id !== null);
    const unassigned = projects.filter((p) => p.family_id === null);
    assigned.sort((a, b) => {
      const fa = familyName(a.family_id) ?? "";
      const fb = familyName(b.family_id) ?? "";
      return fa.localeCompare(fb) || a.name.localeCompare(b.name);
    });
    return [...assigned, ...unassigned];
  }, [projects, familyName]);

  const selected = projects.find((p) => p.id === projectId) ?? null;
  const parsed = Number.parseInt(magnitude, 10);
  const points = Number.isFinite(parsed) ? (negative ? -parsed : parsed) : NaN;

  const submit = async () => {
    if (!projectId) {
      setError("Pick a project.");
      return;
    }
    if (!Number.isFinite(points) || points === 0) {
      setError("Enter a non-zero number of points.");
      return;
    }
    if (Math.abs(points) > POINTS_MAX) {
      setError(`Points must be between -${POINTS_MAX} and ${POINTS_MAX}.`);
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }

    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("award_score", {
      p_project_id: projectId,
      p_points: points,
      p_reason: reason.trim(),
      p_awarded_on: awardedOn || null,
      p_semester_id: semester?.id ?? null,
    });
    setPending(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onOpenChange(false);
    await onAwarded();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Award points</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {semester ? `Counts toward ${semester.name}.` : "No semester is active."}
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label>Project</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                  <span className="truncate">{selected ? selected.name : "Pick a project"}</span>
                  <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width] max-h-72 overflow-y-auto"
              >
                {ordered.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => setProjectId(p.id)}>
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {familyName(p.family_id) ?? "No family"}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {selected && selected.family_id === null && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This project has no family, so these points won&apos;t count on the scoreboard.
              </p>
            )}
            {selected && selected.family_id !== null && (
              <p className="text-xs text-muted-foreground">
                Scores for {familyName(selected.family_id)}.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="award-points">Points</Label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNegative((n) => !n)}
                className={`h-9 w-9 flex items-center justify-center rounded-md border transition-colors ${
                  negative
                    ? "bg-destructive text-destructive-foreground border-transparent"
                    : "bg-background hover:bg-accent"
                }`}
                aria-label={negative ? "Switch to awarding points" : "Switch to deducting points"}
                aria-pressed={negative}
              >
                {negative ? <Minus size={15} /> : <Plus size={15} />}
              </button>
              <Input
                id="award-points"
                type="number"
                min={1}
                max={POINTS_MAX}
                value={magnitude}
                onChange={(e) => setMagnitude(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="0"
                className="w-28"
              />
              <div className="flex gap-1">
                {POINT_PRESETS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setMagnitude(String(n))}
                    className="px-2 py-1 rounded-md border text-xs hover:bg-accent transition-colors"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {negative ? "Deducting points." : "Awarding points."}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="award-reason">Reason</Label>
              <span className="text-[10px] text-muted-foreground/60">
                {reason.length}/{REASON_MAX}
              </span>
            </div>
            <textarea
              id="award-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Won the GM trivia night"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Shown to every member on the scoreboard.
            </p>
          </div>

          <div className="flex flex-col gap-1 w-44">
            <Label htmlFor="award-date">Date</Label>
            <Input
              id="award-date"
              type="date"
              value={awardedOn}
              onChange={(e) => setAwardedOn(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={pending || !semester}>
              {pending ? "Saving…" : "Award"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
