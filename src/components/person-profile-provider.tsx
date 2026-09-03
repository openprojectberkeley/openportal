"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Crown } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProfileModal } from "@/components/profile-modal";
import { cn } from "@/lib/utils";
import { sortRoles } from "@/lib/role-order";
import { readableTextColor, DEFAULT_ACCENT } from "@/lib/portal-color";

export type Role = { id: string; role_name: string };

export type MemberProject = { id: string; name: string; is_pm: boolean; color: string | null };

export type PublicProfile = {
  user_id: string;
  preferred_firstname: string | null;
  lastname: string | null;
  email: string | null;
  major: string | null;
  grad_year: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  interests: string | null;
  pronouns: string | null;
  status: "active" | "inactive" | "non_member" | "blacklisted" | null;
  avatar_url: string | null;
  roles: Role[];
  projects: MemberProject[];
};

export type OpenTarget = { userId: string; name: string; preloaded?: Partial<PublicProfile> };

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// A project pill tinted with the project's own accent color, with a crown
// appended when the member is a PM of that project. Shared by the hover card and
// the full profile modal so both stay in sync.
export function ProjectBadge({ project }: { project: MemberProject }) {
  const bg = project.color || DEFAULT_ACCENT;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: bg, color: readableTextColor(bg) }}
    >
      {project.name}
      {project.is_pm && <Crown size={11} className="fill-current shrink-0" />}
    </span>
  );
}

type ContextValue = {
  openProfile: (target: OpenTarget) => void;
  getCached: (userId: string) => PublicProfile | undefined;
  ensureLoaded: (userId: string) => void;
};

const PersonProfileContext = createContext<ContextValue | null>(null);

export function usePersonProfile(): ContextValue {
  const ctx = useContext(PersonProfileContext);
  if (!ctx) throw new Error("usePersonProfile must be used within a PersonProfileProvider");
  return ctx;
}

export function PersonProfileProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<OpenTarget | null>(null);
  // Cache of full profiles keyed by user_id, shared between hover cards and the modal.
  const [cache, setCache] = useState<Record<string, PublicProfile>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const ensureLoaded = useCallback(
    (userId: string) => {
      if (!userId) return;
      if (cache[userId] || inFlight.current.has(userId)) return;
      inFlight.current.add(userId);
      fetch(`/api/members/${userId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: PublicProfile | null) => {
          if (data) setCache((prev) => ({ ...prev, [userId]: data }));
        })
        .catch(() => {})
        .finally(() => inFlight.current.delete(userId));
    },
    [cache],
  );

  const openProfile = useCallback((next: OpenTarget) => setTarget(next), []);
  const getCached = useCallback((userId: string) => cache[userId], [cache]);

  return (
    <PersonProfileContext.Provider value={{ openProfile, getCached, ensureLoaded }}>
      {children}
      <ProfileModal
        target={target}
        cached={target ? cache[target.userId] : undefined}
        onLoaded={(p) => setCache((prev) => ({ ...prev, [p.user_id]: p }))}
        onClose={() => setTarget(null)}
      />
    </PersonProfileContext.Provider>
  );
}

type PersonNameProps = {
  userId?: string | null;
  name: string;
  preloaded?: Partial<PublicProfile>;
  className?: string;
};

// Inline, clickable person name. Hovering shows a mini preview card; clicking
// opens the full profile modal. With no userId it renders as plain text.
export function PersonName({ userId, name, preloaded, className }: PersonNameProps) {
  const { openProfile, getCached, ensureLoaded } = usePersonProfile();

  if (!userId) return <span className={className}>{name}</span>;

  const cached = getCached(userId);
  const roles = sortRoles(cached?.roles ?? preloaded?.roles ?? []);
  const projects = cached?.projects ?? preloaded?.projects ?? [];

  return (
    <HoverCard openDelay={200} closeDelay={100} onOpenChange={(o) => o && ensureLoaded(userId)}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => openProfile({ userId, name, preloaded })}
          className={cn(
            "inline text-left underline decoration-dotted decoration-foreground/40 underline-offset-2 hover:decoration-solid hover:decoration-foreground cursor-pointer",
            className,
          )}
        >
          {name}
        </button>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-foreground/10 flex items-center justify-center text-xs font-semibold flex-shrink-0">
            {initials(name)}
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="font-semibold text-sm truncate">{name}</span>
            {(roles.length > 0 || projects.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {roles.map((r) => (
                  <span
                    key={r.id}
                    className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium"
                  >
                    {r.role_name}
                  </span>
                ))}
                {projects.map((p) => (
                  <ProjectBadge key={p.id} project={p} />
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Click to view full profile</p>
      </HoverCardContent>
    </HoverCard>
  );
}
