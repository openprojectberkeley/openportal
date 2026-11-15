"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPicker, type ComboOption } from "@/components/ui/combobox";

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

type Props = {
  options: MemberOption[];
  onAdd: (m: MemberOption) => void;
  filters: AddMemberFilters;
  trigger?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
};

// Searchable add-member picker (cmdk). One search box does the work of the
// old name search + role and project <select>s: each member carries their
// roles and projects as search keywords, so typing "design" or a project name
// narrows to those people, and their roles show as a hint on the right.
// Arrow keys + Enter pick. Stays open so several people can be added in a row.
// Add-only: the caller owns the mutation and its own roster state.
export function AddMemberPicker({ options, onAdd, filters, trigger, side = "bottom", align = "start" }: Props) {
  const { roles, projects, memberRoleIds, memberProjectIds } = filters;

  // When the picker is rendered inside a Radix Dialog, portal the popover into
  // that dialog's content so it inherits the dialog's pointer-events region and
  // focus scope. Outside a dialog this stays null and the popover portals to
  // body as usual.
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const probeRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) setDialogContainer(node.closest<HTMLElement>("[role='dialog']"));
  }, []);

  const comboOptions = useMemo<ComboOption[]>(() => {
    const roleName = new Map(roles.map((r) => [r.id, r.role_name]));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    return options.map((m) => {
      const memberRoles = [...(memberRoleIds.get(m.user_id) ?? [])].map((id) => roleName.get(id)).filter(Boolean) as string[];
      const memberProjects = [...(memberProjectIds.get(m.user_id) ?? [])].map((id) => projectName.get(id)).filter(Boolean) as string[];
      return {
        value: m.user_id,
        label: m.name,
        keywords: [...memberRoles, ...memberProjects],
        hint: memberRoles.slice(0, 2).join(", ") || undefined,
      };
    });
  }, [options, roles, projects, memberRoleIds, memberProjectIds]);

  return (
    <>
      {/* Zero-box probe used to locate an enclosing Dialog for the portal. */}
      <span ref={probeRef} className="hidden" aria-hidden />
      <CommandPicker
        options={comboOptions}
        onSelect={(id) => {
          const m = options.find((o) => o.user_id === id);
          if (m) onAdd(m);
        }}
        keepOpen
        container={dialogContainer}
        align={align}
        searchPlaceholder="Name, role or project…"
        emptyText={options.length === 0 ? "No members left to add" : "No matches"}
        contentClassName={side === "top" ? "w-80" : "w-80"}
      >
        {trigger ?? (
          <Button size="sm" variant="outline">
            <PlusCircle size={14} /> Add member
          </Button>
        )}
      </CommandPicker>
    </>
  );
}
