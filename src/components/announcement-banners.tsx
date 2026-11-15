"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { accentRing, readableTextColor } from "@/lib/portal-color";
import { staggerStyle } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Announcement } from "@/lib/announcements";

export function AnnouncementBanner({
  message,
  color,
  className,
  style,
}: {
  message: string;
  color: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  // An accent surface like any other: flat fill, text picked for contrast,
  // and a 1px ring in its own colour instead of a drop shadow.
  return (
    <div
      className={cn("flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium", className)}
      style={{ backgroundColor: color, color: readableTextColor(color), boxShadow: accentRing(color, 40), ...style }}
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
      {items.map((a, i) => (
        <AnnouncementBanner
          key={a.id}
          message={a.message}
          color={a.color}
          className="animate-fade-in-up"
          style={staggerStyle(i)}
        />
      ))}
    </div>
  );
}

/**
 * Live announcements as one glass strip hanging off the bottom of the sticky
 * header (rendered inside AppNavbar's sticky wrapper, so it stays attached
 * while scrolling). Square top flush with the header rule, rounded bottom.
 * Each announcement is its own band in its colour at ~72% over a blurred,
 * saturated page, with readable text and the gradient rim.
 */
export function HeaderAnnouncements() {
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
    <div className="mx-auto w-full max-w-6xl px-5">
      <div className="rim-card flex flex-col overflow-hidden rounded-b-xl shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] animate-fade-in-up">
        {items.map((a, i) => (
          <div
            key={a.id}
            className={cn(
              "flex items-start gap-2.5 px-4 py-2 text-sm font-medium backdrop-blur-xl backdrop-saturate-150",
              i > 0 && "border-t border-black/10",
            )}
            style={{
              backgroundColor: `color-mix(in srgb, ${a.color} 72%, transparent)`,
              color: readableTextColor(a.color),
            }}
          >
            <Megaphone size={15} className="mt-0.5 shrink-0" aria-hidden />
            <p className="whitespace-pre-line break-words">{a.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
