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

import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { FileQuestion } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAddableMembers, type AddableMember, type AddableStatus } from "@/lib/use-addable-members";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

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

function ApplicantPickerPanel({
  note,
  applicants,
  alreadyPicked,
  onPick,
  memberSearch,
  compact = false,
}: {
  // Optional caveat (e.g. adding after the draft is complete).
  note?: string;
  applicants: PickableApplicant[] | null;
  alreadyPicked: string[];
  onPick: (applicationId: string) => void;
  memberSearch?: MemberSearch;
  /** Popover use: no outer border, a shorter list. */
  compact?: boolean;
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
        <div className="flex flex-col gap-3">
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {/* cmdk for keyboard picking (arrows + Enter) during a live draft.
              shouldFilter is off: this component already filters applicants
              locally and searches accounts on the server. */}
          <Command shouldFilter={false} className={compact ? "" : "rounded-md border"}>
            <CommandInput
              autoFocus
              placeholder={memberSearch ? "Search by name or email…" : "Search applicants…"}
              value={filter}
              onValueChange={setFilter}
            />
            <CommandList className={compact ? "max-h-64 border-t" : "max-h-72 border-t"}>
              {applicants === null ? (
                <div aria-hidden className="overflow-hidden p-1">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="flex items-center px-2 py-1.5">
                      <span className="flex h-5 items-center">
                        <Skeleton className={`h-3.5 rounded-full ${["w-32", "w-24", "w-40", "w-28", "w-36", "w-24"][i]}`} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : showEmpty ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {memberSearch ? "Nobody matches that." : "No matching applicants."}
                </p>
              ) : (
                <>
                  {options.length > 0 && (
                    <CommandGroup heading={grouped ? "Applied" : undefined}>
                      {options.map((a) => (
                        <CommandItem key={a.id} value={`app-${a.id}`} onSelect={() => onPick(a.id)}>
                          {a.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {memberSearch && memberRows.length > 0 && (
                    <CommandGroup heading="Not in the draft pool">
                      {memberRows.map((m) => (
                        <CommandItem
                          key={m.user_id}
                          value={`member-${m.user_id}`}
                          onSelect={() => { forget(m.user_id); memberSearch.onPick(m); }}
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
                        </CommandItem>
                      ))}
                    </CommandGroup>
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
            </CommandList>
          </Command>
        </div>
  );
}

type PickerProps = {
  note?: string;
  applicants: PickableApplicant[] | null;
  alreadyPicked: string[];
  onPick: (applicationId: string) => void;
  memberSearch?: MemberSearch;
};

export function ApplicantPickerDialog({ title, onClose, ...props }: PickerProps & { title: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ApplicantPickerPanel {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** The same picker as a small overlay anchored to its trigger (no modal). */
export function ApplicantPickerPopover({
  open,
  onOpenChange,
  children,
  ...props
}: PickerProps & { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <ApplicantPickerPanel {...props} compact />
      </PopoverContent>
    </Popover>
  );
}
