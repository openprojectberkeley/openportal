"use client";

// The exec's manual-add picker: search a period's draft-eligible applicants and
// pick one to place on a project. Shared by the draft manager (adding to a
// specific round-project) and the cross-project board's "add member" card
// (adding to a project, the round chosen server-side by 0091's
// draft_destination_round_project). Presentational only -- the caller owns the
// roster, the filter state and the mutation.
//
// The board also passes `members`: accounts with no application this period
// (0096). One search box drives both lists -- applicants filtered here in the
// browser, members searched server-side by the caller's hook -- because from the
// exec's side the question is just "who am I adding?", and which list someone
// happens to be in is the answer, not the question. The member group only
// renders once the caller opts in, so the draft manager keeps its old behaviour.

import { FileQuestion } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type PickableApplicant = { id: string; name: string };

// An account with no application in play this period -- see AddableMember in
// use-all-projects-board.
export type PickableMember = {
  user_id: string;
  name: string | null;
  email: string | null;
  has_draft: boolean;
};

// The member half of the picker. Absent for callers that only place applicants.
export type MemberPicker = {
  members: PickableMember[] | null;
  searching: boolean;
  // Search hasn't started because the query is under `minChars`.
  tooShort: boolean;
  minChars: number;
  onPick: (member: PickableMember) => void;
};

function memberLabel(m: PickableMember): string {
  return m.name?.trim() || m.email || "Member";
}

export function ApplicantPickerDialog({
  title,
  note,
  applicants,
  alreadyPicked,
  filter,
  onFilterChange,
  onPick,
  onClose,
  memberPicker,
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
  memberPicker?: MemberPicker;
}) {
  const pickedSet = new Set(alreadyPicked);
  const options = (applicants ?? []).filter(
    (a) => !pickedSet.has(a.id) && a.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const members = memberPicker?.members ?? [];
  // Only worth a heading once the two lists can be confused for each other.
  const grouped = !!memberPicker && (members.length > 0 || options.length > 0);
  // "No matching applicants" is only the whole truth when the member half has
  // nothing to add to it -- and it would be wrong to say it while that half is
  // still typing or searching.
  const memberHalfPending =
    !!memberPicker && (memberPicker.searching || memberPicker.tooShort);
  const showEmpty =
    applicants !== null && options.length === 0 && members.length === 0 && !memberHalfPending;

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
            placeholder={memberPicker ? "Search by name or email…" : "Search applicants…"}
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
          />
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {applicants === null ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading applicants…</p>
            ) : showEmpty ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {memberPicker ? "Nobody matches that." : "No matching applicants."}
              </p>
            ) : (
              <>
                {grouped && options.length > 0 && (
                  <p className="px-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Applied
                  </p>
                )}
                {options.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onPick(a.id)}
                    className="rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    {a.name}
                  </button>
                ))}

                {memberPicker && members.length > 0 && (
                  <>
                    <p className="px-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      No application
                    </p>
                    {members.map((m) => (
                      <button
                        key={m.user_id}
                        type="button"
                        onClick={() => memberPicker.onPick(m)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <FileQuestion size={13} className="shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{memberLabel(m)}</span>
                          {/* The email disambiguates two people with one name,
                              and is the only label when a profile has no name. */}
                          {m.email && m.name?.trim() && (
                            <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                          )}
                        </span>
                        {m.has_draft && (
                          <span
                            className="ml-auto shrink-0 text-[11px] text-muted-foreground"
                            title="They started an application this period but never submitted it. Adding them submits what they wrote."
                          >
                            unfinished draft
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}

                {memberPicker && memberPicker.searching && (
                  <p className="py-2 text-center text-xs text-muted-foreground">Searching accounts…</p>
                )}
                {memberPicker && memberPicker.tooShort && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    Type {memberPicker.minChars}+ characters to also search accounts that never
                    applied.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
