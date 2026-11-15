"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { readableTextColor } from "@/lib/portal-color";
import { cn } from "@/lib/utils";
import { Segments } from "@/components/header-banners";

/**
 * An announcement as the site shows it full size (header-banners.tsx), boxed
 * for previewing inside a panel. `countdownAt` adds the live timer.
 */
export function AnnouncementBanner({
  message,
  color,
  countdownAt,
  className,
  style,
}: {
  message: string;
  color: string;
  countdownAt?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!countdownAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [countdownAt]);
  const left = countdownAt && now > 0 ? Math.max(0, new Date(countdownAt).getTime() - now) : 0;

  return (
    <div
      className={cn("flex flex-col items-center justify-between gap-4 rounded-xl px-5 py-4 sm:flex-row", className)}
      style={{ backgroundColor: color, color: readableTextColor(color), ...style }}
    >
      <div className={cn("flex flex-col gap-1", left > 0 ? "min-w-0" : "w-full")}>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider opacity-70">
          <Megaphone size={12} aria-hidden /> Announcement
        </span>
        <p className="whitespace-pre-line break-words text-base font-semibold">{message}</p>
      </div>
      {left > 0 && <Segments ms={left} />}
    </div>
  );
}
