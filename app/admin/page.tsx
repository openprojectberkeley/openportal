"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, PlusCircle, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useRoleSim } from "@/components/role-simulation-provider";

type Role = { id: string; role_name: string };

type Member = {
  user_id: string;
  preferred_firstname: string | null;
  lastname: string | null;
  major: string | null;
  grad_year: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  roles: Role[];
};

const DETAIL_LABELS: { key: keyof Member; label: string }[] = [
  { key: "major", label: "Major" },
  { key: "grad_year", label: "Grad year" },
  { key: "phone", label: "Phone" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "github", label: "GitHub" },
];

export default function AdminPage() {
  const router = useRouter();
  const { ready, isExec } = useRoleSim();
  const [members, setMembers] = useState<Member[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());

  // Guard: redirect out once we know the effective role isn't exec (honors the
  // "view as" simulation).
  useEffect(() => {
    if (ready && !isExec) router.replace("/");
  }, [ready, isExec, router]);

  useEffect(() => {
    if (!ready || !isExec) return;
    const supabase = createClient();

    Promise.all([
      fetch("/api/admin/members").then((r) => r.json()),
      supabase.from("roles").select("id, role_name").order("role_name"),
    ]).then(([membersData, { data: rolesData }]) => {
      if (membersData.error) { setError(membersData.error); }
      else { setMembers(membersData); }
      setAllRoles(rolesData ?? []);
      setLoading(false);
    }).catch(() => { setError("Failed to load."); setLoading(false); });
  }, [ready, isExec]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleRole = async (member: Member, role: Role, hasRole: boolean) => {
    const supabase = createClient();

    if (hasRole) {
      await supabase
        .from("members_roles")
        .delete()
        .eq("user_id", member.user_id)
        .eq("role_id", role.id);

      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id
            ? { ...m, roles: m.roles.filter((r) => r.id !== role.id) }
            : m,
        ),
      );
    } else {
      await supabase
        .from("members_roles")
        .insert({ user_id: member.user_id, role_id: role.id });

      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id
            ? { ...m, roles: [...m.roles, role] }
            : m,
        ),
      );
    }
  };

  const toggleRoleFilter = (roleId: string) =>
    setRoleFilter((prev) => {
      const next = new Set(prev);
      next.has(roleId) ? next.delete(roleId) : next.add(roleId);
      return next;
    });

  const filtered = members.filter((m) => {
    const name = [m.preferred_firstname, m.lastname].filter(Boolean).join(" ").toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (roleFilter.size > 0 && !m.roles.some((r) => roleFilter.has(r.id))) return false;
    return true;
  });

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-8 text-sm text-red-500">{error}</div>;

  return (
    <div className="p-8 w-full max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Members</h1>

      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
              Filter by role
              {roleFilter.size > 0 && (
                <span className="ml-1 bg-foreground text-background rounded-full px-1.5 py-0.5 text-xs">
                  {roleFilter.size}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {allRoles.map((role) => (
              <DropdownMenuCheckboxItem
                key={role.id}
                checked={roleFilter.has(role.id)}
                onCheckedChange={() => toggleRoleFilter(role.id)}
              >
                {role.role_name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {(search || roleFilter.size > 0) && (
          <button
            onClick={() => { setSearch(""); setRoleFilter(new Set()); }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        {filtered.map((m, i) => {
          const isOpen = expanded.has(m.user_id);
          const name = [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "—";
          return (
            <div key={m.user_id} className={i > 0 ? "border-t" : ""}>
              <div
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer"
                onClick={() => toggle(m.user_id)}
              >
                <span className="text-muted-foreground flex-shrink-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                  <span className="font-medium text-sm">{name}</span>
                  {m.roles.map((r) => (
                    <span
                      key={r.id}
                      className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium"
                    >
                      {r.role_name}
                    </span>
                  ))}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <PlusCircle size={15} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                      {allRoles.map((role) => {
                        const hasRole = m.roles.some((r) => r.id === role.id);
                        return (
                          <DropdownMenuCheckboxItem
                            key={role.id}
                            checked={hasRole}
                            onCheckedChange={() => toggleRole(m, role, hasRole)}
                          >
                            {role.role_name}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {isOpen && (
                <div className="px-11 pb-4 pt-1 grid grid-cols-2 gap-x-8 gap-y-2 bg-accent/20">
                  {DETAIL_LABELS.map(({ key, label }) => (
                    <div key={key} className="flex gap-2 text-sm">
                      <span className="text-muted-foreground w-24 flex-shrink-0">{label}</span>
                      <span>{(m[key] as string) || "—"}</span>
                    </div>
                  ))}
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
    </div>
  );
}
