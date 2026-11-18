"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { PersonName } from "@/components/person-profile-provider";
import { AddMemberPicker, useAddMemberFilters } from "@/components/add-member-picker";
import { RosterRowsSkeleton } from "@/components/skeletons";
import { AdminCrown } from "@/components/admin-crown";
import { optimistic } from "@/lib/optimistic";
import { useConfirm } from "@/components/ui/use-confirm";
import { Input } from "@/components/ui/input";

// `managed` rows mirror the project roster (0013 sync triggers), so edits to
// them go through project_members instead. Owner rows are locked and their
// crowns render gold.
type MemberRow = { user_id: string; name: string; is_admin: boolean; managed: boolean; owner: boolean };
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
  // Set for project portals: the roster is the project's, so writes go there.
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const filters = useAddMemberFilters(open && canEdit);

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
      supabase.from("portals").select("type, project_id").eq("id", portalId).single(),
    ]).then(([{ data: pmRows }, { data: memberRows }, { data: portal }]) => {
      setProjectId(portal?.type === "project" ? (portal.project_id as string | null) : null);
      setRows(
        (pmRows ?? [])
          .map((pm) => {
            const m = pm.members as unknown as { preferred_firstname: string | null; lastname: string | null } | null;
            return {
              user_id: pm.user_id as string,
              name: fullName(m?.preferred_firstname, m?.lastname),
              is_admin: pm.is_admin as boolean,
              managed: pm.managed as boolean,
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

  // All three show the change immediately and confirm in the background; a
  // refused write puts the row back and toasts.
  const addMember = (m: MemberOption) => {
    const supabase = createClient();
    void optimistic({
      label: "member",
      key: `portal-member:${m.user_id}`,
      apply: () =>
        setRows((prev) =>
          prev.some((r) => r.user_id === m.user_id)
            ? prev
            : [...prev, { ...m, is_admin: false, managed: !!projectId, owner: false }].sort(byName),
        ),
      rollback: () => setRows((prev) => prev.filter((r) => r.user_id !== m.user_id)),
      commit: () =>
        projectId
          ? supabase.from("project_members").insert({ project_id: projectId, user_id: m.user_id, is_pm: false })
          : supabase.from("portal_members").insert({ portal_id: portalId, user_id: m.user_id, is_admin: false }),
    });
  };

  const applyRemoveMember = (row: MemberRow) => {
    const supabase = createClient();
    void optimistic({
      label: "member",
      key: `portal-member:${row.user_id}`,
      apply: () => setRows((prev) => prev.filter((r) => r.user_id !== row.user_id)),
      rollback: () =>
        setRows((prev) => (prev.some((r) => r.user_id === row.user_id) ? prev : [...prev, row].sort(byName))),
      commit: () =>
        row.managed && projectId
          ? supabase.from("project_members").delete().eq("project_id", projectId).eq("user_id", row.user_id).select("user_id")
          : supabase.from("portal_members").delete().eq("portal_id", portalId).eq("user_id", row.user_id).select("user_id"),
      requireRows: true,
    });
  };

  // Access changes ask first (DESIGN.md), then apply optimistically.
  const { ask, dialog: confirmDialog } = useConfirm();
  const [query, setQuery] = useState("");
  const removeMember = (row: MemberRow) => {
    ask({
      title: `Remove ${row.name} from this ${row.managed && projectId ? "project" : "portal"}?`,
      confirmLabel: "Remove",
      destructive: true,
      run: () => applyRemoveMember(row),
    });
  };
  const toggleAdmin = (row: MemberRow) => {
    const next = !row.is_admin;
    ask({
      title: next ? `Make ${row.name} an admin?` : `Remove ${row.name} as admin?`,
      description: next ? "Admins can edit this portal and its roster." : undefined,
      confirmLabel: next ? "Make admin" : "Remove admin",
      destructive: !next,
      run: () => applyToggleAdmin(row, next),
    });
  };
  const applyToggleAdmin = (row: MemberRow, next: boolean) => {
    const supabase = createClient();
    const setAdmin = (v: boolean) =>
      setRows((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, is_admin: v } : r)));
    void optimistic({
      label: "admin access",
      key: `portal-admin:${row.user_id}`,
      apply: () => setAdmin(next),
      rollback: () => setAdmin(!next),
      commit: () =>
        row.managed && projectId
          ? supabase.from("project_members").update({ is_pm: next }).eq("project_id", projectId).eq("user_id", row.user_id).select("user_id")
          : supabase.from("portal_members").update({ is_admin: next }).eq("portal_id", portalId).eq("user_id", row.user_id).select("user_id"),
      requireRows: true,
    });
  };

  // Owner rows are always locked; managed rows are editable only when the
  // write can be routed to the project (i.e. this is a project portal).
  const isLocked = (r: MemberRow) => r.owner || (r.managed && !projectId);

  const available = allMembers.filter((m) => !rows.some((r) => r.user_id === m.user_id));
  const q = query.trim().toLowerCase();
  // Owner, then admins, then everyone else (each group stays alphabetical).
  const rank = (r: MemberRow) => (r.owner ? 0 : r.is_admin ? 1 : 2);
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b));
  const shownRows = q ? ordered.filter((r) => r.name.toLowerCase().includes(q)) : ordered;
  // A block of rows at a time as the roster scrolls (see useProgressiveList).
  const { visible: mountedRows, pendingRows, sentinelRef } = useProgressiveList(shownRows, {
    resetKey: `${open}|${loading}|${q}`,
  });

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

        {confirmDialog}
        {/* Shown (disabled) while loading too, so the roster doesn't shift
            down when it arrives; hidden after for short rosters. */}
        {(loading || rows.length > 5) && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            placeholder="Search members…"
            aria-label="Search members"
            className="h-8 flex-shrink-0 text-sm"
          />
        )}
        {/* Scrollable roster fills the remaining height; overflow scrolls here.
            The right padding keeps the overlay scrollbar off the remove buttons. */}
        <ScrollArea className="flex-1 min-h-0" viewportClassName="pr-3">
          {loading ? (
            <RosterRowsSkeleton rows={9} crownSize={16} className="flex flex-col gap-1 pt-1.5" />
          ) : shownRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{rows.length === 0 ? "No members yet." : "No matches."}</p>
          ) : (
            <div className="flex flex-col gap-1 pt-1.5">
              {mountedRows.map((r) => (
                <div key={r.user_id} className="flex items-center gap-2 text-sm py-1">
                  <PersonName userId={r.user_id} name={r.name} className="flex-1 min-w-0 truncate" />
                  <AdminCrown
                    active={r.is_admin}
                    owner={r.owner}
                    locked={isLocked(r)}
                    onToggle={!isLocked(r) && canEdit ? () => toggleAdmin(r) : undefined}
                  />
                  {/* The remove column is always reserved so crowns stay aligned
                      even when a member can't be removed. */}
                  {!isLocked(r) && canEdit ? (
                    <button onClick={() => removeMember(r)} aria-label={`Remove ${r.name}`} className="w-4 flex-shrink-0 flex justify-center text-muted-foreground hover:text-destructive transition-colors">
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="w-4 flex-shrink-0" aria-hidden />
                  )}
                </div>
              ))}
              {/* Rows still to come: scrolling into them loads them. */}
              <RosterRowsSkeleton rows={pendingRows} rowRef={sentinelRef} crownSize={16} className="contents" />
            </div>
          )}
        </ScrollArea>

        {/* Add member stays locked to the bottom-left, below the roster. */}
        {canEdit && (
          <div className="flex-shrink-0 pt-3 mt-1 border-t">
            <AddMemberPicker options={available} onAdd={addMember} filters={filters} side="left" align="end" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
