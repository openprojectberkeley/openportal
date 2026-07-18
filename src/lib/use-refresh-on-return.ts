"use client";

import { useEffect } from "react";

/**
 * Re-runs `refetch` whenever the user returns to a page that fetches its own
 * data on mount. Browser back/forward, bfcache restores, and tab switches can
 * restore an already-rendered client tree without remounting it, so the mount
 * effect never re-runs and the page shows stale data (e.g. a booking that was
 * cancelled elsewhere still appearing). Listening for these return signals
 * forces a fresh read.
 */
export function useRefreshOnReturn(refetch: () => void) {
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "hidden") refetch();
    };
    document.addEventListener("visibilitychange", run);
    window.addEventListener("pageshow", run); // bfcache restore
    window.addEventListener("popstate", run); // browser back/forward
    return () => {
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("pageshow", run);
      window.removeEventListener("popstate", run);
    };
  }, [refetch]);
}
