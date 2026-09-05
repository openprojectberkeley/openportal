"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { initials, ProjectBadge, type OpenTarget, type PublicProfile } from "@/components/person-profile-provider";
import { CoffeeChatIndicator, InfosessionIndicator } from "@/components/applicant-indicators";
import { sortRoles } from "@/lib/role-order";
import { MEMBER_STATUS_BADGE_LABEL } from "@/lib/member-status";

type Props = {
  target: OpenTarget | null;
  cached?: PublicProfile;
  onLoaded: (profile: PublicProfile) => void;
  onClose: () => void;
};

// The single, app-level profile modal. Driven by PersonProfileProvider — one
// instance for the whole app rather than one per name. Seeds from preloaded /
// cached data for an instant render, then fetches the full record.
export function ProfileModal({ target, cached, onLoaded, onClose }: Props) {
  const [data, setData] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const userId = target?.userId ?? null;

  useEffect(() => {
    if (!userId) return;
    if (cached) {
      setData(cached);
      setError(false);
      setLoading(false);
      return;
    }
    setData(null);
    setError(false);
    setLoading(true);
    let active = true;
    fetch(`/api/members/${userId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((profile: PublicProfile) => {
        if (!active) return;
        setData(profile);
        onLoaded(profile);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, cached]);

  const name = target?.name ?? "";
  // Merge: preloaded fields fill gaps until the full record arrives.
  const merged = { ...target?.preloaded, ...(data ?? {}) } as Partial<PublicProfile>;
  const roles = sortRoles(merged.roles ?? []);
  const projects = merged.projects ?? [];

  const contact: { label: string; value: string; href?: string }[] = [];
  if (merged.email) contact.push({ label: "Email", value: merged.email, href: `mailto:${merged.email}` });
  if (merged.phone) contact.push({ label: "Phone", value: merged.phone, href: `tel:${merged.phone}` });
  if (merged.linkedin)
    contact.push({ label: "LinkedIn", value: merged.linkedin, href: hrefFor(merged.linkedin) });
  if (merged.github) contact.push({ label: "GitHub", value: merged.github, href: hrefFor(merged.github) });

  const academic: { label: string; value: string }[] = [];
  if (merged.major) academic.push({ label: "Major", value: merged.major });
  if (merged.grad_year) academic.push({ label: "Year", value: String(merged.grad_year) });

  // This modal is portaled at the app root, so it's a DOM *sibling* of any modal
  // it was opened from (e.g. the portal-members modal) rather than a descendant.
  // Radix decides a lower layer was "clicked outside" — and dismisses it — when an
  // interaction bubbles all the way to `document`. Stopping our own interaction
  // events here keeps clicks inside this modal (including the X button) from
  // closing the modal underneath. The overlay is a separate element, so
  // click-outside still closes this modal normally.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="p-0 overflow-hidden"
        onPointerDown={stop}
        onPointerUp={stop}
        onMouseDown={stop}
        onMouseUp={stop}
        onClick={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
      >
        <ScrollArea viewportClassName="max-h-[90vh] p-6">
        <DialogHeader>
          <div className="flex items-center gap-4">
            {merged.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={merged.avatar_url}
                alt={name}
                className="h-14 w-14 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="h-14 w-14 rounded-full bg-foreground/10 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {initials(name)}
              </div>
            )}
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                <DialogTitle className="truncate">{name}</DialogTitle>
                {merged.pronouns && (
                  <span className="text-sm text-muted-foreground">{merged.pronouns}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {roles.map((r) => (
                  <span
                    key={r.id}
                    className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-xs font-medium"
                  >
                    {r.role_name}
                  </span>
                ))}
                {projects.map((p) => (
                  <ProjectBadge key={p.id} project={p} />
                ))}
                {merged.status && MEMBER_STATUS_BADGE_LABEL[merged.status] && (
                  <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-muted-foreground text-xs font-medium">
                    {MEMBER_STATUS_BADGE_LABEL[merged.status]}
                  </span>
                )}
                <CoffeeChatIndicator state={merged.coffee_chat} />
                <InfosessionIndicator attended={merged.infosession_attended} />
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-5 text-sm">
          {academic.length > 0 && <Section title="Academic" rows={academic} />}
          {contact.length > 0 && <Section title="Contact" rows={contact} />}
          {merged.interests && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interests</h3>
              <p className="text-foreground leading-relaxed">{merged.interests}</p>
            </div>
          )}

          {loading && !data && <p className="text-muted-foreground py-2">Loading profile…</p>}
          {error && !data && <p className="text-red-500 py-2">Couldn&apos;t load this profile.</p>}
          {!loading && !error && academic.length === 0 && contact.length === 0 && !merged.interests && (
            <p className="text-muted-foreground py-2">No additional details.</p>
          )}
        </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; href?: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-3">
            <dt className="w-28 flex-shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground">
              {row.href ? (
                <a
                  href={row.href}
                  target={row.href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground/70"
                >
                  {row.value}
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// LinkedIn/GitHub fields may be stored as full URLs, bare handles, or
// "linkedin.com/in/..." — normalize to something clickable.
function hrefFor(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  if (v.includes(".") && v.includes("/")) return `https://${v}`;
  return undefined;
}
