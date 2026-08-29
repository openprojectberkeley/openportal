"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type MemberOption = { user_id: string; name: string };

export type AddMemberFilters = {
  roles: { id: number; role_name: string }[];
  projects: { id: string; name: string }[];
  memberRoleIds: Map<string, Set<number>>;
  memberProjectIds: Map<string, Set<string>>;
};

const EMPTY_FILTERS: AddMemberFilters = {
  roles: [],
  projects: [],
  memberRoleIds: new Map(),
  memberProjectIds: new Map(),
};

// Loads the metadata that powers the role/project filters. Fetch this once at
// the modal/panel level (gated on `enabled`) and pass it into every
// `AddMemberPicker` so the queries don't run per-picker instance.
export function useAddMemberFilters(enabled: boolean): AddMemberFilters {
  const [filters, setFilters] = useState<AddMemberFilters>(EMPTY_FILTERS);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.from("roles").select("id, role_name"),
      supabase.from("projects").select("id, name"),
      supabase.from("members_roles").select("user_id, role_id"),
      supabase.from("project_members").select("user_id, project_id"),
    ]).then(([rolesRes, projectsRes, mrRes, pmRes]) => {
      if (cancelled) return;
      const memberRoleIds = new Map<string, Set<number>>();
      for (const r of (mrRes.data ?? []) as { user_id: string | null; role_id: number | null }[]) {
        if (!r.user_id || r.role_id == null) continue;
        (memberRoleIds.get(r.user_id) ?? memberRoleIds.set(r.user_id, new Set()).get(r.user_id)!).add(r.role_id);
      }
      const memberProjectIds = new Map<string, Set<string>>();
      for (const p of (pmRes.data ?? []) as { user_id: string; project_id: string }[]) {
        (memberProjectIds.get(p.user_id) ?? memberProjectIds.set(p.user_id, new Set()).get(p.user_id)!).add(p.project_id);
      }
      setFilters({
        roles: ((rolesRes.data ?? []) as { id: number; role_name: string | null }[])
          .filter((r) => r.role_name)
          .map((r) => ({ id: r.id, role_name: r.role_name as string }))
          .sort((a, b) => a.role_name.localeCompare(b.role_name)),
        projects: ((projectsRes.data ?? []) as { id: string; name: string }[])
          .map((p) => ({ id: p.id, name: p.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        memberRoleIds,
        memberProjectIds,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return filters;
}

const selectClass =
  "h-8 flex-1 min-w-0 rounded-md border border-input bg-transparent px-2 text-xs text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type Props = {
  options: MemberOption[];
  onAdd: (m: MemberOption) => void;
  filters: AddMemberFilters;
  trigger?: React.ReactNode;
};

// Compact popover for adding a member: a search box plus role and project
// filters over a scrollable result list. Add-only — the caller owns the
// mutation and its own roster state.
export function AddMemberPicker({ options, onAdd, filters, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<number | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const { roles, projects, memberRoleIds, memberProjectIds } = filters;

  // When the picker is rendered inside a Radix Dialog, portal the popover into
  // that dialog's content so it inherits the dialog's pointer-events region and
  // focus scope. Outside a dialog this stays null and the popover portals to
  // body as usual.
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const probeRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) setDialogContainer(node.closest<HTMLElement>("[role='dialog']"));
  }, []);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return options.filter(
      (m) =>
        (q === "" || m.name.toLowerCase().includes(q)) &&
        (roleFilter == null || memberRoleIds.get(m.user_id)?.has(roleFilter)) &&
        (projectFilter == null || memberProjectIds.get(m.user_id)?.has(projectFilter)),
    );
  }, [options, search, roleFilter, projectFilter, memberRoleIds, memberProjectIds]);

  // Reset the transient filter/search state whenever the popover closes.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearch("");
      setRoleFilter(null);
      setProjectFilter(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* Zero-box probe used to locate an enclosing Dialog for the portal. */}
      <span ref={probeRef} className="hidden" aria-hidden />
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <PlusCircle size={14} /> Add member
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent container={dialogContainer} align="start" className="w-72 p-2">
        <div className="flex flex-col gap-2">
          <Input
            autoFocus
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
          <div className="flex gap-2">
            <select
              className={selectClass}
              value={roleFilter ?? ""}
              onChange={(e) => setRoleFilter(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role_name}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={projectFilter ?? ""}
              onChange={(e) => setProjectFilter(e.target.value || null)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-2 py-3 text-xs text-center text-muted-foreground">No members left to add</p>
            ) : results.length === 0 ? (
              <p className="px-2 py-3 text-xs text-center text-muted-foreground">No matches</p>
            ) : (
              <div className="flex flex-col">
                {results.map((m) => (
                  <button
                    key={m.user_id}
                    onClick={() => {
                      onAdd(m);
                      handleOpenChange(false);
                    }}
                    className="rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
