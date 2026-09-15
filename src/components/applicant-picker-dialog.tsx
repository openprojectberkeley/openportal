"use client";

// The exec's manual-add picker: search a period's draft-eligible applicants and
// pick one to place on a project. Shared by the draft manager (adding to a
// specific round-project) and the cross-project board's "add member" card
// (adding to a project, the round chosen server-side by 0091's
// draft_destination_round_project).
//
// The search box's state lives HERE, not in the caller. It used to be hoisted
// into the board, which meant every keystroke re-rendered ~19 columns of
// un-memoized applicant cards -- and once the member search (below) added its
// own per-keystroke state on top, typing repainted that whole tree two or three
// times per character. The dialog is mounted per open, so local state also
// resets on its own and callers no longer have to clear a filter on close.
//
// `memberSearch` opts a caller into the second half: accounts outside the draft
// pool (0096, widened in 0098) -- never applied, left a draft unsubmitted, or
// were rejected -- searched server-side while the applicant list is filtered
// here in the browser. One box drives both, because from the exec's side the
// question is just "who am I adding?" -- which list someone happens to be in is
// the answer, not the question.

import { useState } from "react";
import { FileQuestion } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAddableMembers, type AddableMember, type AddableStatus } from "@/lib/use-addable-members";

export type PickableApplicant = { id: string; name: string };
export type { AddableMember } from "@/lib/use-addable-members";

// Opts the caller into searching accounts outside the draft pool. `periodId`
// scopes the search; `onPick` receives the chosen account.
export type MemberSearch = {
  periodId: string | null;
  onPick: (member: AddableMember) => void;
};

function memberLabel(m: AddableMember): string {
  return m.name?.trim() || m.email || "Member";
}

// Why a row is out of the draft pool, and what picking it will do. Said per row
// rather than as a group heading: these three have nothing in common except
// "not currently draftable", and filing a rejected applicant under "No
// application" would be plainly false -- they wrote one.
const STATUS_NOTE: Record<"none" | "draft" | "rejected", { label: string; title: string; tone: string }> = {
  none: {
    label: "no application",
    title: "They never started an application this period. Adding them creates one so they can be drafted.",
    tone: "text-muted-foreground",
  },
  draft: {
    label: "unfinished draft",
    title: "They started an application this period but never submitted it. Adding them submits what they wrote.",
    tone: "text-muted-foreground",
  },
  rejected: {
    label: "rejected",
    title: "Their application was rejected this period. Adding them reverts that and puts them back in the draft.",
    tone: "text-destructive",
  },
};

const statusKey = (s: AddableStatus) => (s === "draft" ? "draft" : s === "rejected" ? "rejected" : "none");

export function ApplicantPickerDialog({
  title,
  note,
  applicants,
  alreadyPicked,
  onPick,
  onClose,
  memberSearch,
}: {
  title: string;
  // Optional caveat under the title (e.g. adding after the draft is complete).
  note?: string;
  applicants: PickableApplicant[] | null;
  alreadyPicked: string[];
  onPick: (applicationId: string) => void;
  onClose: () => void;
  memberSearch?: MemberSearch;
}) {
  const [filter, setFilter] = useState("");
  const { members, searching, tooShort, minChars, forget } = useAddableMembers(
    memberSearch?.periodId ?? null,
    filter,
    !!memberSearch,
  );

  const pickedSet = new Set(alreadyPicked);
  const options = (applicants ?? []).filter(
    (a) => !pickedSet.has(a.id) && a.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const memberRows = members ?? [];
  // Only worth a heading once the two lists can be confused for each other.
  const grouped = !!memberSearch && (memberRows.length > 0 || options.length > 0);
  // "Nobody matches that" is only the whole truth when the member half has
  // nothing to add to it -- and it would be wrong to say it while that half is
  // still typing or searching.
  const memberHalfPending = !!memberSearch && (searching || tooShort);
  const showEmpty =
    applicants !== null && options.length === 0 && memberRows.length === 0 && !memberHalfPending;

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
            placeholder={memberSearch ? "Search by name or email…" : "Search applicants…"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {applicants === null ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading applicants…</p>
            ) : showEmpty ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {memberSearch ? "Nobody matches that." : "No matching applicants."}
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

                {memberSearch && memberRows.length > 0 && (
                  <>
                    <p className="px-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Not in the draft pool
                    </p>
                    {memberRows.map((m) => (
                      <button
                        key={m.user_id}
                        type="button"
                        onClick={() => { forget(m.user_id); memberSearch.onPick(m); }}
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
                        <span
                          className={`ml-auto shrink-0 text-[11px] ${STATUS_NOTE[statusKey(m.app_status)].tone}`}
                          title={STATUS_NOTE[statusKey(m.app_status)].title}
                        >
                          {STATUS_NOTE[statusKey(m.app_status)].label}
                        </span>
                      </button>
                    ))}
                  </>
                )}

                {memberSearch && searching && (
                  <p className="py-2 text-center text-xs text-muted-foreground">Searching accounts…</p>
                )}
                {memberSearch && tooShort && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    Type {minChars}+ characters to also search accounts outside the draft pool.
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
