"use client";

import { PersonName, initials } from "@/components/person-profile-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { sortRoles } from "@/lib/role-order";

export type CoffeeHost = {
  name: string;
  roles: { id: string; role_name: string }[];
  avatarUrl: string | null;
  interests: string | null;
};

/**
 * Who the coffee chat is with: avatar, name (the page title), roles as one
 * muted line and their interests. Shared by the booking page and the host's
 * read-only availability view. Pass `host={null}` while it loads.
 */
export function HostHeader({ userId, host }: { userId: string; host: CoffeeHost | null }) {
  if (!host) return <HostHeaderSkeleton />;
  const roles = sortRoles(host.roles);
  return (
    <div className="flex items-start gap-4">
      {host.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={host.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="h-14 w-14 rounded-full bg-foreground/10 flex items-center justify-center text-sm font-semibold flex-shrink-0">
          {initials(host.name)}
        </div>
      )}
      <div className="flex flex-col gap-1 min-w-0 pt-1">
        <h1 className="text-2xl font-bold tracking-tight">
          <PersonName
            userId={userId}
            name={host.name}
            preloaded={{ roles: host.roles, avatar_url: host.avatarUrl, interests: host.interests }}
          />
        </h1>
        {roles.length > 0 && (
          <p className="text-sm text-muted-foreground">{roles.map((r) => r.role_name).join(", ")}</p>
        )}
        {host.interests && (
          <p className="mt-1 max-w-prose text-sm leading-relaxed">
            <span className="font-medium">Interests: </span>
            <span className="text-muted-foreground">{host.interests}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function HostHeaderSkeleton() {
  return (
    <div className="flex items-start gap-4" aria-hidden>
      <Skeleton className="h-14 w-14 rounded-full flex-shrink-0" />
      <div className="flex flex-col gap-2 min-w-0 flex-1 pt-1.5">
        <Skeleton className="h-6 w-44 rounded-full" />
        <Skeleton className="h-3.5 w-32 rounded-full" />
        <Skeleton className="mt-1 h-3.5 w-full max-w-md rounded-full" />
      </div>
    </div>
  );
}
