"use client";

// The exec's manual-add picker: search a period's draft-eligible applicants and
// pick one to place on a project. Shared by the draft manager (adding to a
// specific round-project) and the cross-project board's "add member" card
// (adding to a project, the round chosen server-side by 0091's
// draft_destination_round_project). Presentational only -- the caller owns the
// roster, the filter state and the mutation.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type PickableApplicant = { id: string; name: string };

export function ApplicantPickerDialog({
  title,
  note,
  applicants,
  alreadyPicked,
  filter,
  onFilterChange,
  onPick,
  onClose,
}: {
  title: string;
  // Optional caveat under the title (e.g. adding after the draft is complete).
  note?: string;
  applicants: PickableApplicant[] | null;
  alreadyPicked: string[];
  filter: string;
  onFilterChange: (value: string) => void;
  onPick: (applicationId: string) => void;
  onClose: () => void;
}) {
  const pickedSet = new Set(alreadyPicked);
  const options = (applicants ?? []).filter(
    (a) => !pickedSet.has(a.id) && a.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          <Input
            autoFocus
            placeholder="Search applicants…"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
          />
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {applicants === null ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading applicants…</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No matching applicants.</p>
            ) : (
              options.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onPick(a.id)}
                  className="rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {a.name}
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
