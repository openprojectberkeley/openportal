"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, PlusCircle, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useRoleSim } from "@/components/role-simulation-provider";
import { ProjectsPanel } from "@/components/projects-panel";
import { PortalsPanel } from "@/components/portals-panel";
import { FamiliesPanel } from "@/components/families-panel";
import { AnnouncementsPanel } from "@/components/announcements-panel";
import { PanelListSkeleton } from "@/components/skeletons";
import { PersonName } from "@/components/person-profile-provider";
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_VALUES, type MemberStatus } from "@/lib/member-status";
import { staggerStyle } from "@/lib/motion";
import { optimistic } from "@/lib/optimistic";
import { CommandPicker } from "@/components/ui/combobox";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { TabStrip } from "@/components/ui/tab-strip";
import { useConfirm } from "@/components/ui/use-confirm";
import { Skeleton } from "@/components/ui/skeleton";

type Tab = "members" | "projects" | "families" | "portals" | "announcements";

type Role = { id: string; role_name: string };

// Light row from /api/admin/members; details load per member on expand.
type Member = {
  user_id: string;
  preferred_firstname: string | null;
  lastname: string | null;
  status: MemberStatus;
  roles: Role[];
};

type MemberDetails = {
  major: string | null;
  grad_year: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
};

const DETAIL_LABELS: { key: keyof MemberDetails; label: string }[] = [
  { key: "major", label: "Major" },
  { key: "grad_year", label: "Grad year" },
  { key: "phone", label: "Phone" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "github", label: "GitHub" },
];

export default function AdminPage() {
  const router = useRouter();
  const { ready, isExec } = useRoleSim();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<Member[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<MemberStatus>>(new Set());
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [portalCount, setPortalCount] = useState<number | null>(null);
  const [familyCount, setFamilyCount] = useState<number | null>(null);
  const [announcementCount, setAnnouncementCount] = useState<number | null>(null);

  // Guard: redirect out once we know the effective role isn't exec (honors the
  // "view as" simulation).
  useEffect(() => {
    if (ready && !isExec) router.replace("/");
  }, [ready, isExec, router]);

  // Data starts loading on mount, in parallel with the role check above,
  // rather than after it: the members API enforces exec itself, so a 401/403
  // from it is the authoritative "not allowed" and sends you home. The page
  // shell (title, tabs) paints immediately; only the list waits.
  useEffect(() => {
    const supabase = createClient();

    Promise.all([
      fetch("/api/admin/members").then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          router.replace("/");
          return { denied: true };
        }
        return r.json();
      }),
      supabase.from("roles").select("id, role_name").order("role_name"),
    ]).then(([membersData, { data: rolesData }]) => {
      if (membersData?.denied) return;
      if (membersData.error) { setError(membersData.error); }
      else { setMembers(membersData); }
      setAllRoles(rolesData ?? []);
      setLoading(false);
    }).catch(() => { setError("Failed to load."); setLoading(false); });

    // Header counts (exec is a member of every portal via is_exec(), so these
    // are unrestricted for exec).
    supabase.from("projects").select("id", { count: "exact", head: true })
      .then(({ count }) => setProjectCount(count ?? 0));
    supabase.from("portals").select("id", { count: "exact", head: true })
      .then(({ count }) => setPortalCount(count ?? 0));
    supabase.from("families").select("id", { count: "exact", head: true })
      .then(({ count }) => setFamilyCount(count ?? 0));
    supabase.from("announcements").select("id", { count: "exact", head: true })
      .then(({ count }) => setAnnouncementCount(count ?? 0));
  }, [router]);

  // Rows first, details lazy: opening a member shows skeleton lines at once
  // and fetches their details (cached for the session).
  const [details, setDetails] = useState<Record<string, MemberDetails>>({});
  const loadDetails = (id: string) => {
    fetch(`/api/admin/members/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.error) setDetails((prev) => ({ ...prev, [id]: d }));
      })
      .catch(() => {});
  };
  // The fetch starts outside the state updater (React may run updaters twice).
  const toggle = (id: string) => {
    const opening = !expanded.has(id);
    if (opening && !details[id]) loadDetails(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Access changes ask first. The role picker closes before the dialog opens.
  const { ask, dialog: confirmDialog } = useConfirm();
  const [rolePickerFor, setRolePickerFor] = useState<string | null>(null);
  const memberName = (m: Member) => [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "this member";
  const confirmRole = (m: Member, role: Role) => {
    const hasRole = m.roles.some((r) => r.id === role.id);
    setRolePickerFor(null);
    ask({
      title: hasRole ? `Remove ${role.role_name} from ${memberName(m)}?` : `Give ${memberName(m)} the ${role.role_name} role?`,
      description: "Roles control what they can see and manage.",
      confirmLabel: hasRole ? "Remove role" : "Add role",
      destructive: hasRole,
      run: () => toggleRole(m, role, hasRole),
    });
  };
  const confirmStatus = (m: Member, status: MemberStatus) => {
    if (status === m.status) return;
    ask({
      title: `Change ${memberName(m)} to ${MEMBER_STATUS_LABEL[status]}?`,
      confirmLabel: "Change status",
      destructive: status === "blacklisted",
      run: () => setStatus(m, status),
    });
  };

  const toggleRole = (member: Member, role: Role, hasRole: boolean) => {
    const supabase = createClient();
    const withRole = (on: boolean) =>
      setMembers((prev) =>
        prev.map((m) => {
          if (m.user_id !== member.user_id) return m;
          const without = m.roles.filter((r) => r.id !== role.id);
          return { ...m, roles: on ? [...without, role] : without };
        }),
      );
    void optimistic({
      label: "role",
      key: `role:${member.user_id}:${role.id}`,
      apply: () => withRole(!hasRole),
      rollback: () => withRole(hasRole),
      commit: () =>
        hasRole
          ? supabase
              .from("members_roles")
              .delete()
              .eq("user_id", member.user_id)
              .eq("role_id", role.id)
              .select("user_id")
          : supabase
              .from("members_roles")
              .insert({ user_id: member.user_id, role_id: role.id })
              .select("user_id"),
      requireRows: true,
    });
  };

  const toggleRoleFilter = (roleId: string) =>
    setRoleFilter((prev) => {
      const next = new Set(prev);
      next.has(roleId) ? next.delete(roleId) : next.add(roleId);
      return next;
    });

  const toggleStatusFilter = (status: MemberStatus) =>
    setStatusFilter((prev) => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });

  // Errors roll back this one member and toast; they no longer replace the
  // whole admin page.
  const setStatus = (member: Member, status: MemberStatus) => {
    if (status === member.status) return;
    const previous = member.status;
    const supabase = createClient();
    const withStatus = (s: MemberStatus) =>
      setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, status: s } : m)));
    void optimistic({
      label: "member status",
      key: `status:${member.user_id}`,
      apply: () => withStatus(status),
      rollback: () => withStatus(previous),
      commit: () => supabase.rpc("set_member_status", { p_user_id: member.user_id, p_status: status }),
    });
  };

  const filtered = members.filter((m) => {
    const name = [m.preferred_firstname, m.lastname].filter(Boolean).join(" ").toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (roleFilter.size > 0 && !m.roles.some((r) => roleFilter.has(r.id))) return false;
    if (statusFilter.size > 0 && !statusFilter.has(m.status)) return false;
    return true;
  });

  const memberOptions = members.map((m) => ({
    user_id: m.user_id,
    name: [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "—",
  }));

  return (
    <div className="p-8 w-full max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Admin</h1>

      {confirmDialog}
      <TabStrip
        aria-label="Admin sections"
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "members", label: "Members", count: loading ? null : members.length },
          { value: "projects", label: "Projects", count: projectCount },
          { value: "families", label: "Families", count: familyCount },
          { value: "portals", label: "Portals", count: portalCount },
          { value: "announcements", label: "Announcements", count: announcementCount },
        ]}
      />

      {tab === "projects" ? (
        <ProjectsPanel members={memberOptions} />
      ) : tab === "families" ? (
        <FamiliesPanel />
      ) : tab === "announcements" ? (
        <AnnouncementsPanel onCountChange={setAnnouncementCount} />
      ) : tab === "portals" ? (
        <PortalsPanel members={memberOptions} allRoles={allRoles} />
      ) : (
      <>
      <div className="flex flex-wrap gap-3 mb-4">
        <Input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <MultiSelectFilter
          label="Role"
          className="px-3 py-2 text-sm"
          options={allRoles.map((r) => ({ key: r.id, label: r.role_name }))}
          selected={roleFilter}
          onToggle={toggleRoleFilter}
          onClear={() => setRoleFilter(new Set())}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
              Filter by status
              {statusFilter.size > 0 && (
                <span className="text-xs text-muted-foreground">({statusFilter.size})</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {MEMBER_STATUS_VALUES.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={statusFilter.has(status)}
                onCheckedChange={() => toggleStatusFilter(status)}
              >
                {MEMBER_STATUS_LABEL[status]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {(search || roleFilter.size > 0 || statusFilter.size > 0) && (
          <button
            onClick={() => { setSearch(""); setRoleFilter(new Set()); setStatusFilter(new Set()); }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {error ? (
        <p className="py-8 text-sm text-destructive">{error}</p>
      ) : loading ? (
        <PanelListSkeleton rows={8} />
      ) : (
      <div className="flex flex-col gap-0.5">
        {filtered.map((m, i) => {
          const isOpen = expanded.has(m.user_id);
          const name = [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "—";
          return (
            <div key={m.user_id} className="rounded-lg transition-colors hover:bg-foreground/[0.03] animate-fade-in-up" style={staggerStyle(i)}>
              {/* One hover only: the rounded row wrapper's tint. */}
              <div
                className="flex items-center gap-3 rounded-lg px-4 py-3 cursor-pointer"
                onClick={() => toggle(m.user_id)}
              >
                <span className="text-muted-foreground flex-shrink-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                  <span onClick={(e) => e.stopPropagation()} className="min-w-0 max-w-[16rem] truncate">
                    <PersonName userId={m.user_id} name={name} preloaded={m} className="font-medium text-sm" />
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        // A control, not a pill: coloured status text + chevron.
                        className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-xs font-medium hover:bg-foreground/[0.06] ${
                          m.status === "active"
                            ? "text-success"
                            : m.status === "blacklisted"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {MEMBER_STATUS_LABEL[m.status]}
                        <ChevronDown size={12} className="opacity-60" aria-hidden />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                      {MEMBER_STATUS_VALUES.map((status) => (
                        <DropdownMenuCheckboxItem
                          key={status}
                          checked={m.status === status}
                          onCheckedChange={() => confirmStatus(m, status)}
                        >
                          {MEMBER_STATUS_LABEL[status]}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {/* Roles as one muted line rather than a pill each. */}
                  {m.roles.length > 0 && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground" title={m.roles.map((r) => r.role_name).join(", ")}>
                      {m.roles.map((r) => r.role_name).join(", ")}
                    </span>
                  )}
                  {/* Searchable role toggle: pick to add, pick again to remove.
                      Stays open so several roles can be set in one go. */}
                  <span onClick={(e) => e.stopPropagation()} className="contents">
                    <CommandPicker
                      open={rolePickerFor === m.user_id}
                      onOpenChange={(o) => setRolePickerFor(o ? m.user_id : null)}
                      options={allRoles.map((role) => {
                        const hasRole = m.roles.some((r) => r.id === role.id);
                        return {
                          value: role.id,
                          label: role.role_name,
                          icon: <Check className={hasRole ? "opacity-100" : "opacity-0"} />,
                        };
                      })}
                      onSelect={(id) => {
                        const role = allRoles.find((r) => r.id === id);
                        if (role) confirmRole(m, role);
                      }}
                      searchPlaceholder="Search roles…"
                      contentClassName="w-56"
                    >
                      <button
                        aria-label={`Edit roles for ${[m.preferred_firstname, m.lastname].filter(Boolean).join(" ")}`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <PlusCircle size={15} />
                      </button>
                    </CommandPicker>
                  </span>
                </div>
              </div>
              {isOpen && (
                // Opens instantly; skeleton lines until this member's details arrive.
                <div className="grid animate-expand">
                <div className="min-h-0 overflow-hidden">
                <div className="mx-1 mb-1 grid grid-cols-1 gap-x-8 gap-y-2 rounded-lg surface px-10 pb-4 pt-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
                  {DETAIL_LABELS.map(({ key, label }) => (
                    <div key={key} className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-24 flex-shrink-0">{label}</span>
                      {details[m.user_id] ? (
                        <span className="min-w-0 break-all">{details[m.user_id][key] || "—"}</span>
                      ) : (
                        <Skeleton className="h-3.5 w-32" />
                      )}
                    </div>
                  ))}
                </div>
                </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {members.length === 0 ? "No members yet." : "No members match your filters."}
          </div>
        )}
      </div>
      )}
      </>
      )}
    </div>
  );
}
