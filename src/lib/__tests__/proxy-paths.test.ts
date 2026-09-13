// Regression test for the login-redirect exemption in src/lib/supabase/proxy.ts.
//
// The proxy matcher covers /api/*, so without this exemption the scheduled
// calendar sync — called by Vercel Cron with a CRON_SECRET bearer token and no
// Supabase session cookie — gets a 307 to /auth/login and never runs. That
// failure is silent: the cron reports success, and the calendar just quietly
// stops updating. Worth a test precisely because nothing else would catch it.

import { describe, expect, it } from "vitest";
import { isSelfAuthorizingPath } from "@/lib/supabase/proxy";

describe("isSelfAuthorizingPath", () => {
  it("exempts the calendar sync route, with or without a trailing slash", () => {
    expect(isSelfAuthorizingPath("/api/admin/calendar-sync")).toBe(true);
    expect(isSelfAuthorizingPath("/api/admin/calendar-sync/")).toBe(true);
  });

  it("does not exempt the other admin routes, which need a session", () => {
    expect(isSelfAuthorizingPath("/api/admin/portals")).toBe(false);
    expect(isSelfAuthorizingPath("/api/admin/members")).toBe(false);
    expect(isSelfAuthorizingPath("/api/admin/projects")).toBe(false);
  });

  it("does not exempt app pages", () => {
    expect(isSelfAuthorizingPath("/")).toBe(false);
    expect(isSelfAuthorizingPath("/manager")).toBe(false);
  });

  // A prefix match would hand the exemption to anything underneath the path.
  it("matches the exact path only, not a prefix", () => {
    expect(isSelfAuthorizingPath("/api/admin/calendar-sync/secrets")).toBe(false);
    expect(isSelfAuthorizingPath("/api/admin/calendar-syncing")).toBe(false);
  });
});
