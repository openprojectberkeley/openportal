"use client";

type Role = { id: string; role_name: string };

export type CoffeeChatCardProps = {
  id: string;
  name: string;
  roles: Role[];
  avatarUrl?: string | null;
  interests?: string | null;
  onBook?: () => void;
};

export function CoffeeChatCard({ name, roles, avatarUrl, interests, onBook }: CoffeeChatCardProps) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="border rounded-xl p-5 flex flex-col gap-4 bg-background hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="h-14 w-14 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="h-14 w-14 rounded-full bg-foreground/10 flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="font-semibold text-sm">{name}</span>
          <div className="flex flex-wrap gap-1">
            {roles.map((r) => (
              <span
                key={r.id}
                className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium"
              >
                {r.role_name}
              </span>
            ))}
          </div>
        </div>
      </div>
      {interests && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Interests: </span>{interests}
        </p>
      )}
      <button
        onClick={onBook}
        className="mt-auto w-full rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
      >
        Book Meeting
      </button>
    </div>
  );
}
