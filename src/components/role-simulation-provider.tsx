"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  PERSONA_ACCESS_LEVELS,
  PERSONA_LABELS,
  PERSONAS,
  SIM_COOKIE,
  accessIsBoardOrExec,
  accessIsExec,
  hasElevatedRole,
  isPersona,
  personaFromAccessLevels,
  type Persona,
  type MemberRoleRow,
} from "@/lib/roles";
import { Segmented } from "@/components/ui/segmented";

type RoleSim = {
  ready: boolean;
  canSimulate: boolean;
  simulating: boolean;
  persona: Persona;
  setPersona: (p: Persona) => void;
  accessLevels: string[];
  isBoardOrExec: boolean;
  isExec: boolean;
  // Real project-management fact (is_pm on any project); not persona-simulated.
  isPm: boolean;
};

const RoleContext = createContext<RoleSim | null>(null);

// Lets a floating dock (support-button.tsx) host the "View as" switcher in its
// own row. While one is mounted the provider stops rendering the standalone
// pill, so the two bottom-right controls sit side by side instead of stacked
// over the page. Pages without a dock (admin, onboarding) keep the standalone.
const DockClaimContext = createContext<((claimed: boolean) => void) | null>(null);

export function useClaimFloatingDock() {
  const claim = useContext(DockClaimContext);
  useEffect(() => {
    claim?.(true);
    return () => claim?.(false);
  }, [claim]);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

export function RoleSimulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [canSimulate, setCanSimulate] = useState(false);
  const [realLevels, setRealLevels] = useState<string[]>([]);
  const [persona, setPersonaState] = useState<Persona>("member");
  const [isPm, setIsPm] = useState(false);
  const [dockClaimed, setDockClaimed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setReady(true); return; }

      const { data: roleRows } = await supabase
        .from("members_roles")
        .select("roles(role_name, access_level)")
        .eq("user_id", user.id);

      const roles = ((roleRows ?? []) as unknown as MemberRoleRow[]).flatMap((r) => (r.roles ? [r.roles] : []));
      const levels = roles.map((r) => r.access_level).filter(Boolean) as string[];
      const canSim = hasElevatedRole(roles);
      // The PM role is kept in sync with "PM of a current project" by the
      // database (0108), so roles alone decide board access.
      const pm = roles.some((r) => r.role_name?.toLowerCase() === "pm");

      setRealLevels(levels);
      setCanSimulate(canSim);
      setIsPm(pm);

      const saved = readCookie(SIM_COOKIE);
      setPersonaState(canSim && isPersona(saved) ? saved : personaFromAccessLevels(levels));
      setReady(true);
    });
  }, []);

  const setPersona = useCallback((p: Persona) => {
    setPersonaState(p);
    document.cookie = `${SIM_COOKIE}=${p}; path=/; max-age=31536000; samesite=lax`;
    // Re-run server components (manager guard, admin API) with the new cookie.
    router.refresh();
  }, [router]);

  const accessLevels = canSimulate ? PERSONA_ACCESS_LEVELS[persona] : realLevels;
  const realP = personaFromAccessLevels(realLevels);

  const value: RoleSim = {
    ready,
    canSimulate,
    simulating: canSimulate && persona !== realP,
    persona: canSimulate ? persona : realP,
    setPersona,
    accessLevels,
    isBoardOrExec: accessIsBoardOrExec(accessLevels),
    isExec: accessIsExec(accessLevels),
    isPm,
  };

  return (
    <RoleContext.Provider value={value}>
      <DockClaimContext.Provider value={setDockClaimed}>
        {children}
        {ready && canSimulate && !dockClaimed && (
          <RoleSimToggle persona={persona} onChange={setPersona} className="fixed bottom-4 right-4 z-50" />
        )}
      </DockClaimContext.Provider>
    </RoleContext.Provider>
  );
}

export function RoleSimToggle({
  persona,
  onChange,
  className,
}: {
  persona: Persona;
  onChange: (p: Persona) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border glass px-2 py-1.5 shadow-overlay ${className ?? ""}`}
    >
      <span className="pl-1.5 text-[11px] font-medium text-muted-foreground">View as</span>
      <Segmented
        aria-label="View as"
        shape="pill"
        className="border-0 p-0"
        itemClassName="px-2.5"
        value={persona}
        onChange={onChange}
        options={PERSONAS.map((p) => ({ value: p, label: PERSONA_LABELS[p] }))}
      />
    </div>
  );
}

export function useRoleSim(): RoleSim {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    // Provider not mounted — safe, no-access defaults.
    return {
      ready: true, canSimulate: false, simulating: false, persona: "member",
      setPersona: () => {}, accessLevels: [], isBoardOrExec: false, isExec: false, isPm: false,
    };
  }
  return ctx;
}
