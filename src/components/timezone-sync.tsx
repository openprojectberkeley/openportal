"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Silently keeps members.timezone in sync with the browser's detected IANA
// zone, once per mounted session. Powers notify_coffee_chat_counterparty
// (0039), which localizes notification text to the RECIPIENT's stored zone
// instead of the Postgres session default (UTC) — without this, every host's
// "someone booked at ..." notice showed the raw UTC hour. The RPC is a no-op
// when the stored value already matches, so this is cheap to call on mount.
export function TimezoneSync() {
  useEffect(() => {
    let zone: string;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone) return;

    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.rpc("set_member_timezone", { p_timezone: zone });
    })();
  }, []);

  return null;
}
