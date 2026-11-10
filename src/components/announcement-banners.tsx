"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readableTextColor } from "@/lib/portal-color";
import { cn } from "@/lib/utils";
import type { Announcement } from "@/lib/announcements";

export function AnnouncementBanner({
  message,
  color,
  className,
}: {
  message: string;
  color: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-sm", className)}
      style={{ backgroundColor: color, color: readableTextColor(color) }}
    >
      <Megaphone size={16} className="mt-0.5 shrink-0" />
      <p className="whitespace-pre-line break-words">{message}</p>
    </div>
  );
}

/** Live (now inside their start/end window) announcements, stacked. */
export function AnnouncementBanners() {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    let cancelled = false;
    const now = new Date().toISOString();
    createClient()
      .from("announcements")
      .select("id, message, color, starts_at, ends_at")
      .lte("starts_at", now)
      .gte("ends_at", now)
      .order("starts_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setItems((data as Announcement[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {items.map((a) => (
        <AnnouncementBanner key={a.id} message={a.message} color={a.color} />
      ))}
    </div>
  );
}
