"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { PlusCircle, X, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { PersonName } from "@/components/person-profile-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MemberRosterSkeleton } from "@/components/skeletons";
import { AdminCrown } from "@/components/admin-crown";

// `locked` rows (project-derived or the portal owner) are managed by triggers
// and can't be edited from the UI. `owner` crowns render gold.
type MemberRow = { user_id: string; name: string; is_admin: boolean; locked: boolean; owner: boolean };
type MemberOption = { user_id: string; name: string };

type Props = {
  portalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
};

const fullName = (first: string | null | undefined, last: string | null | undefined) =>
  [first, last].filter(Boolean).join(" ") || "—";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

// The portal roster. Everyone can view it; portal admins can add/remove members
// and toggle each member's admin tier.
export function PortalMembersModal({ portalId, open, onOpenChange, canEdit }: Props) {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    setLoading(true);
    Promise.all([
      supabase
        .from("portal_members")
        .select("user_id, is_admin, managed, is_owner, members(preferred_firstname, lastname)")
        .eq("portal_id", portalId),
      // The member directory is readable by any authenticated user; only needed
      // for the add-picker.
      canEdit
        ? supabase.from("members").select("user_id, preferred_firstname, lastname")
        : Promise.resolve({ data: [] as unknown[] }),
    ]).then(([{ data: pmRows }, { data: memberRows }]) => {
      setRows(
        (pmRows ?? [])
          .map((pm) => {
            const m = pm.members as unknown as { preferred_firstname: string | null; lastname: string | null } | null;
            return {
              user_id: pm.user_id as string,
              name: fullName(m?.preferred_firstname, m?.lastname),
              is_admin: pm.is_admin as boolean,
              locked: (pm.managed as boolean) || (pm.is_owner as boolean),
              owner: pm.is_owner as boolean,
            };
          })
          .sort(byName),
      );
      setAllMembers(
        ((memberRows ?? []) as { user_id: string; preferred_firstname: string | null; lastname: string | null }[]).map((m) => ({
          user_id: m.user_id,
          name: fullName(m.preferred_firstname, m.lastname),
        })),
      );
      setLoading(false);
    });
  }, [open, portalId, canEdit]);

  const addMember = async (m: MemberOption) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("portal_members")
      .insert({ portal_id: portalId, user_id: m.user_id, is_admin: false });
    if (error) return;
    setRows((prev) => [...prev, { ...m, is_admin: false, locked: false, owner: false }].sort(byName));
  };

  const removeMember = async (row: MemberRow) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("portal_members")
      .delete()
      .eq("portal_id", portalId)
      .eq("user_id", row.user_id);
    if (error) return;
    setRows((prev) => prev.filter((r) => r.user_id !== row.user_id));
  };

  const toggleAdmin = async (row: MemberRow) => {
    const next = !row.is_admin;
    const supabase = createClient();
    const { error } = await supabase
      .from("portal_members")
      .update({ is_admin: next })
      .eq("portal_id", portalId)
      .eq("user_id", row.user_id);
    if (error) return;
    setRows((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, is_admin: next } : r)));
  };

  const available = allMembers.filter((m) => !rows.some((r) => r.user_id === m.user_id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Locked dimensions: the modal keeps a fixed height and the roster scrolls
          inside it rather than the whole modal growing with the member count. */}
      <DialogContent className="flex flex-col h-[30rem] max-h-[85vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            Members
            {!loading && rows.length > 0 && (
              <span className="ml-1.5 text-sm font-normal text-muted-foreground/60">({rows.length})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable roster fills the remaining height; overflow scrolls here. */}
        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <MemberRosterSkeleton />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No members yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {rows.map((r) => (
                <div key={r.user_id} className="flex items-center gap-2 text-sm py-1">
                  <PersonName userId={r.user_id} name={r.name} className="flex-1 min-w-0 truncate" />
                  {/* Lock sits left of the crown when the admin tier is locked
                      (owner / project-derived). */}
                  {r.locked && r.is_admin && (
                    <Lock size={12} className="text-muted-foreground/60 flex-shrink-0" aria-label="Admin locked" />
                  )}
                  <AdminCrown
                    active={r.is_admin}
                    owner={r.owner}
                    locked={r.locked}
                    onToggle={!r.locked && canEdit ? () => toggleAdmin(r) : undefined}
                  />
                  {/* The remove column is always reserved so crowns stay aligned
                      even when a member can't be removed. */}
                  {!r.locked && canEdit ? (
                    <button onClick={() => removeMember(r)} className="w-4 flex-shrink-0 flex justify-center text-muted-foreground hover:text-red-500 transition-colors">
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="w-4 flex-shrink-0" aria-hidden />
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Add member stays locked to the bottom-left, below the roster. */}
        {canEdit && (
          <div className="flex-shrink-0 pt-3 mt-1 border-t">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <PlusCircle size={14} /> Add member
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="max-h-64 overflow-y-auto">
                {available.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No members left to add</div>
                ) : (
                  available.map((m) => (
                    <DropdownMenuItem key={m.user_id} onSelect={() => addMember(m)}>
                      {m.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
