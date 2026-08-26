"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  coffee_chat_id: string | null;
  meeting_time: string | null;
  member_id: string | null;
  actor_id: string | null;
  read: boolean;
  created_at: string;
};

type ContextValue = {
  items: AppNotification[];
  unreadCount: number;
  userId: string | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  refresh: () => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
};

const NotificationsContext = createContext<ContextValue | null>(null);

// Safe no-op default so components can call the hook even if (in some isolated
// render) the provider isn't mounted, matching the codebase's fallback style.
const NOOP: ContextValue = {
  items: [],
  unreadCount: 0,
  userId: null,
  open: false,
  setOpen: () => {},
  refresh: () => {},
  markAllRead: () => {},
  markRead: () => {},
};

export function useNotifications(): ContextValue {
  return useContext(NotificationsContext) ?? NOOP;
}

const HORIZON_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 60 * 1000;

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Generate this user's own reminder notifications for chats within the next 24h.
// Static hosting has no scheduler, so the recipient's browser self-inserts them
// (RLS allows type='reminder' addressed to self). `existingTimes` are meeting
// times that already have a reminder, so we don't re-insert; the partial unique
// index is the backstop against races. Returns true if any were inserted.
async function generateReminders(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  existingTimes: Set<string>,
): Promise<boolean> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_MS);
  const nowIso = now.toISOString();
  const horizonIso = horizon.toISOString();

  const [{ data: asApplicant }, { data: asHost }] = await Promise.all([
    supabase
      .from("coffee_chats")
      .select("id, meeting_time, duration_minutes, member_id")
      .eq("applicant_id", userId)
      .gte("meeting_time", nowIso)
      .lt("meeting_time", horizonIso),
    supabase
      .from("coffee_chats")
      .select("id, meeting_time, duration_minutes, applicant_id")
      .eq("member_id", userId)
      .not("applicant_id", "is", null)
      .gte("meeting_time", nowIso)
      .lt("meeting_time", horizonIso),
  ]);

  // One reminder per meeting_time (matches the unique index).
  const wanted = new Map<string, { duration: number; otherId: string | null; chatId: string; memberId: string }>();
  for (const r of asApplicant ?? []) {
    const t = new Date(r.meeting_time).toISOString();
    if (!existingTimes.has(t) && !wanted.has(t)) wanted.set(t, { duration: r.duration_minutes, otherId: r.member_id, chatId: r.id, memberId: r.member_id });
  }
  for (const r of asHost ?? []) {
    const t = new Date(r.meeting_time).toISOString();
    if (!existingTimes.has(t) && !wanted.has(t)) wanted.set(t, { duration: r.duration_minutes, otherId: r.applicant_id, chatId: r.id, memberId: userId });
  }
  if (wanted.size === 0) return false;

  const otherIds = [...new Set([...wanted.values()].map((w) => w.otherId).filter((v): v is string => !!v))];
  const nameMap = new Map<string, string>();
  if (otherIds.length > 0) {
    const { data } = await supabase.from("members").select("user_id, preferred_firstname, lastname").in("user_id", otherIds);
    for (const m of data ?? []) nameMap.set(m.user_id, [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "someone");
  }

  let inserted = false;
  for (const [t, w] of wanted) {
    const row = {
      user_id: userId,
      type: "reminder",
      title: "Upcoming coffee chat",
      body: `Your ${w.duration}-min coffee chat with ${w.otherId ? nameMap.get(w.otherId) ?? "someone" : "someone"} is ${whenLabel(t)}.`,
      coffee_chat_id: w.chatId,
      meeting_time: t,
      member_id: w.memberId,
    };
    // Ignore unique-violation (23505) from a concurrent insert of the same reminder.
    const { error } = await supabase.from("notifications").insert(row);
    if (!error) inserted = true;
  }
  return inserted;
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const refreshingRef = useRef(false);

  const fetchItems = useCallback(async (supabase: ReturnType<typeof createClient>, userId: string) => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as AppNotification[];
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const supabase = createClient();
      let userId = userIdRef.current;
      if (!userId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        userId = user.id;
        userIdRef.current = userId;
        setUserId(userId);
      }

      let list = await fetchItems(supabase, userId);
      const existingReminderTimes = new Set(
        list.filter((n) => n.type === "reminder" && n.meeting_time).map((n) => new Date(n.meeting_time!).toISOString()),
      );
      const added = await generateReminders(supabase, userId, existingReminderTimes);
      if (added) list = await fetchItems(supabase, userId);
      setItems(list);
    } finally {
      refreshingRef.current = false;
    }
  }, [fetchItems]);

  // Refresh on mount, on tab focus, and on a slow interval (no realtime).
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    if (!items.some((n) => !n.read)) return;
    setItems((prev) => prev.map((n) => (n.read ? n : { ...n, read: true }))); // optimistic
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  }, [items]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }, []);

  const unreadCount = items.reduce((n, item) => n + (item.read ? 0 : 1), 0);

  return (
    <NotificationsContext.Provider value={{ items, unreadCount, userId, open, setOpen, refresh, markAllRead, markRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}
