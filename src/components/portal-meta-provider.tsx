"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Live, in-session overrides of portal metadata. When a portal's settings are
// saved, the new values land here so every consumer (cards, calendar tints,
// headers) re-renders instantly — no reload. Consumers read `overrides[id] ??
// <their own fetched value>`, so an empty store is harmless.
export type PortalMetaOverride = {
  name: string;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  description: string | null;
};

type PortalMetaValue = {
  overrides: Record<string, PortalMetaOverride>;
  setPortalMeta: (id: string, meta: PortalMetaOverride) => void;
};

const PortalMetaContext = createContext<PortalMetaValue | null>(null);

export function PortalMetaProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, PortalMetaOverride>>({});

  const setPortalMeta = useCallback((id: string, meta: PortalMetaOverride) => {
    setOverrides((prev) => ({ ...prev, [id]: meta }));
  }, []);

  const value = useMemo(() => ({ overrides, setPortalMeta }), [overrides, setPortalMeta]);

  return <PortalMetaContext.Provider value={value}>{children}</PortalMetaContext.Provider>;
}

// Safe when unmounted: returns an empty store + no-op setter, so consumers work
// without the provider (they just won't get instant cross-component updates).
export function usePortalMeta(): PortalMetaValue {
  const ctx = useContext(PortalMetaContext);
  if (ctx) return ctx;
  return { overrides: {}, setPortalMeta: () => {} };
}
