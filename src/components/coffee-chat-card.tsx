"use client";

import { Check } from "lucide-react";
import { PersonName, initials } from "@/components/person-profile-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Role = { id: string; role_name: string };

export type CoffeeChatCardProps = {
  id: string;
  name: string;
  roles: Role[];
  avatarUrl?: string | null;
  interests?: string | null;
  onBook?: () => void;
  disabled?: boolean;
  booked?: boolean;
  // Read-only "everyone's availability" mode: no Book button; the whole card is
  // a link (handled by the parent) and this summary replaces the CTA.
  summary?: { open: number; booked: number };
};

export function CoffeeChatCard({ id, name, roles, avatarUrl, interests, onBook, disabled, booked, summary }: CoffeeChatCardProps) {
  return (
    <div className="h-full rounded-xl p-5 flex flex-col gap-4 surface rim-card">
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-foreground/10 flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {initials(name)}
          </div>
        )}
        <div className="flex flex-col gap-0.5 min-w-0">
          <PersonName
            userId={id}
            name={name}
            preloaded={{ roles, interests }}
            className="font-semibold text-sm"
          />
          {roles.length > 0 && (
            <p className="text-xs text-muted-foreground line-clamp-2">{roles.map((r) => r.role_name).join(", ")}</p>
          )}
        </div>
      </div>
      {interests && (
        <p className="line-clamp-3 text-sm text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Interests: </span>{interests}
        </p>
      )}
      {/* The footer is always h-9 so cards in a row line up whatever their state. */}
      {summary ? (
        <div className="mt-auto flex h-9 items-center gap-2 text-sm">
          <span className={summary.open > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>
            {summary.open} open time{summary.open === 1 ? "" : "s"}
          </span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
          <span className="text-muted-foreground">{summary.booked} booked</span>
        </div>
      ) : booked ? (
        <p className="mt-auto flex h-9 items-center gap-1.5 text-sm font-medium text-success">
          <Check size={16} strokeWidth={2.5} aria-hidden />
          Booked
        </p>
      ) : disabled ? (
        <p className="mt-auto flex h-9 items-center text-sm text-muted-foreground">No open times</p>
      ) : (
        <Button onClick={onBook} className="mt-auto w-full">
          Book a chat
        </Button>
      )}
    </div>
  );
}

// Mirrors CoffeeChatCard: avatar, name and role line, two interest lines, footer.
export function CoffeeChatCardSkeleton() {
  return (
    <div className="h-full rounded-xl p-5 flex flex-col gap-4 surface">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full flex-shrink-0" />
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <Skeleton className="h-3.5 w-28 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full rounded-full" />
        <Skeleton className="h-3.5 w-2/3 rounded-full" />
      </div>
      <Skeleton className="mt-auto h-9 w-full" />
    </div>
  );
}
