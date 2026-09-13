import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely, so it must only ever be
 * constructed inside a server route that has already authorized the caller.
 *
 * The calendar sync needs it for two reasons: a scheduled (cron) run has no
 * user session at all, and the portal_events INSERT policy requires
 * `created_by = auth.uid()`, which synced events have no sensible value for.
 *
 * Never import this from a client component — SUPABASE_SERVICE_ROLE_KEY has no
 * NEXT_PUBLIC_ prefix, so a client import fails at build rather than leaking.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
