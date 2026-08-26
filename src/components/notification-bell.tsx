"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications, type AppNotification } from "@/components/notifications-provider";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// Where a notification should take you: host-facing notices (a booking, an
// applicant cancel, or a reminder for a chat you host) open the manager grid;
// everything else opens the applicant coffee-chat page.
function hrefFor(n: AppNotification, selfId: string | null): string {
  const isHost = !!selfId && n.member_id === selfId;
  return isHost ? "/manager/coffee-chats" : "/coffee-chat";
}

export function NotificationBell() {
  const router = useRouter();
  const { items, unreadCount, userId, markAllRead, markRead } = useNotifications();

  return (
    <DropdownMenu onOpenChange={(o) => { if (o) markAllRead(); }}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Notifications"
          className="relative h-9 w-9 rounded-full flex items-center justify-center hover:bg-accent transition-colors focus:outline-none"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b text-sm font-semibold">Notifications</div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => { markRead(n.id); router.push(hrefFor(n, userId)); }}
                className="w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-accent transition-colors flex gap-2"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${n.read ? "bg-transparent" : "bg-blue-500"}`} />
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium">{n.title}</span>
                  {n.body && <span className="text-xs text-muted-foreground leading-snug">{n.body}</span>}
                  <span className="text-[11px] text-muted-foreground/70">{relativeTime(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
