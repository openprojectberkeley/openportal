"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { staggerStyle } from "@/lib/motion";
import { CoffeeChatCardSkeleton } from "@/components/coffee-chat-card";

export type CoffeeTeamMember = {
  user_id: string;
  name: string;
  roles: { id: string; role_name: string }[];
  interests?: string | null;
};

/**
 * The coffee-chat team: heading with a count, a search over name, role and
 * interests, and an equal-height card grid. Shared by the applicant page
 * (bookable cards) and the host's read-only "Everyone's availability" view;
 * the caller renders each card.
 */
export function CoffeeTeamGrid<T extends CoffeeTeamMember>({
  members,
  loading,
  renderItem,
  title = "Our team",
}: {
  members: T[];
  loading: boolean;
  renderItem: (member: T) => ReactNode;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? members.filter((m) =>
        [m.name, ...m.roles.map((r) => r.role_name), m.interests ?? ""].some((t) => t.toLowerCase().includes(q)),
      )
    : members;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">
          {title}
          {!loading && <span className="ml-1.5 font-normal text-muted-foreground">{shown.length}</span>}
        </h2>
        {(loading || members.length > 0) && (
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, role or interest…"
              aria-label="Search the team"
              className="h-8 pl-8 text-sm"
            />
          </div>
        )}
      </div>
      {loading ? (
        <CoffeeTeamGridSkeleton />
      ) : members.length === 0 ? (
        <p className="rounded-xl surface px-4 py-8 text-center text-sm text-muted-foreground">
          No one is hosting coffee chats right now.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl surface px-4 py-8 text-center text-sm text-muted-foreground">
          Nobody matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4">
          {shown.map((m, i) => (
            <div key={m.user_id} className="flex h-full animate-fade-in-up [&>*]:flex-1" style={staggerStyle(i)}>
              {renderItem(m)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function CoffeeTeamGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4">
      {Array.from({ length: count }, (_, i) => (
        <CoffeeChatCardSkeleton key={i} />
      ))}
    </div>
  );
}
