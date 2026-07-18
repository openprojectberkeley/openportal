"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  PERSONA_ACCESS_LEVELS,
  PERSONA_LABELS,
  PERSONAS,
  SIM_COOKIE,
  VP_TECH_ROLE_NAME,
  accessIsBoardOrExec,
  accessIsExec,
  isPersona,
  personaFromAccessLevels,
  type Persona,
  type MemberRoleRow,
} from "@/lib/roles";

type RoleSim = {
  ready: boolean;
  canSimulate: boolean;
  simulating: boolean;
  persona: Persona;
  setPersona: (p: Persona) => void;
  accessLevels: string[];
  isBoardOrExec: boolean;
  isExec: boolean;
};

const RoleContext = createContext<RoleSim | null>(null);

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
      const vpTech = roles.some((r) => r.role_name === VP_TECH_ROLE_NAME);

      setRealLevels(levels);
      setCanSimulate(vpTech);

      const saved = readCookie(SIM_COOKIE);
      setPersonaState(vpTech && isPersona(saved) ? saved : personaFromAccessLevels(levels));
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
  };

  return (
    <RoleContext.Provider value={value}>
      {children}
      {ready && canSimulate && <RoleSimToggle persona={persona} onChange={setPersona} />}
    </RoleContext.Provider>
  );
}

function RoleSimToggle({ persona, onChange }: { persona: Persona; onChange: (p: Persona) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur">
      <span className="pl-1.5 text-[11px] font-medium text-muted-foreground">View as</span>
      <div className="flex items-center gap-0.5">
        {PERSONAS.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              persona === p ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {PERSONA_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function useRoleSim(): RoleSim {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    // Provider not mounted — safe, no-access defaults.
    return {
      ready: true, canSimulate: false, simulating: false, persona: "member",
      setPersona: () => {}, accessLevels: [], isBoardOrExec: false, isExec: false,
    };
  }
  return ctx;
}
