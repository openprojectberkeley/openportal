"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowRight, Check, Coffee, FileText, Users } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";
import { PortalCard, type PortalSummary } from "@/components/portal-card";
import { CalendarPanel } from "@/components/calendar-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalGridSkeleton, CalendarSkeleton } from "@/components/skeletons";
import { getHomeView, shouldShowReapplyBanner } from "@/lib/member-status";

type CompletionState = {
  coffeeChat: boolean;
  infosession: boolean;
  application: boolean;
};

export default function HomePage() {
  const router = useRouter();
  const { ready, isExec, isBoardOrExec, simulating, persona } = useRoleSim();

  // "dashboard" for anyone who's ever been a member (active/inactive/blacklisted)
  // + board/exec, "checklist" for true first-time applicants (non_member).
  const [view, setView] = useState<"dashboard" | "checklist" | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [portals, setPortals] = useState<PortalSummary[] | null>(null);
  // A currently-active member (non-staff) who hasn't re-applied to the currently
  // open period yet — drives the non-blocking re-apply banner on the dashboard.
  const [reapply, setReapply] = useState<{ periodName: string; infosessionDone: boolean } | null>(null);
  const [completed, setCompleted] = useState<CompletionState>({
    coffeeChat: false,
    infosession: false,
    application: false,
  });

  useEffect(() => {
    // Wait for roles to resolve before deciding, so we don't misclassify a
    // board/exec user as an applicant before we know their access level.
    if (!ready) return;
    const supabase = createClient();

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/login");
        return;
      }

      const { data: member } = await supabase
        .from("members")
        .select("preferred_firstname, status, email")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!member) {
        router.replace("/onboarding");
        return;
      }

      // Backfill the sign-in email onto the member row only when it's missing
      // (rows created before we stored it). Every OAuth sign-in lands here, so
      // this self-heals on next login. We never overwrite an existing value.
      if (!member.email && user.email) {
        await supabase
          .from("members")
          .update({ email: user.email })
          .eq("user_id", user.id);
      }

      // True first-time applicants (non_member, non-staff) get the checklist;
      // anyone who's ever been a member (active/inactive/blacklisted) and
      // board/exec get the portal dashboard.
      if (getHomeView(member.status, isBoardOrExec) === "checklist") {
        setView("checklist");
        // .limit(1) + length check instead of .maybeSingle(): a stray
        // duplicate row (e.g. an applicant claiming two infosession codes)
        // makes .maybeSingle() throw "multiple rows returned", which — since
        // only `data` is read below — silently downgrades to "not completed"
        // instead of surfacing the error.
        const [{ data: coffeeChat }, { data: infosession }, { data: application }] =
          await Promise.all([
            supabase.from("coffee_chats").select("applicant_id").eq("applicant_id", user.id).eq("complete", true).limit(1),
            supabase.from("infosesh_attendance").select("applicant_id").eq("applicant_id", user.id).limit(1),
            supabase.from("applications").select("applicant_id").eq("applicant_id", user.id).in("status", ["submitted", "accepted", "rejected"]).limit(1),
          ]);
        setCompleted({
          coffeeChat: !!coffeeChat?.length,
          infosession: !!infosession?.length,
          application: !!application?.length,
        });
        return;
      }

      setView("dashboard");
      setFirstName(member.preferred_firstname);

      // Active members (non-staff) must re-apply each open round. Show a
      // non-blocking prompt when a period is open and they haven't applied to it
      // yet. Board/exec don't apply, so skip them.
      if (shouldShowReapplyBanner(member.status, isBoardOrExec)) {
        const { data: openPeriods } = await supabase
          .from("application_periods")
          .select("id, name")
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(1);
        const period = openPeriods?.[0] ?? null;
        if (period) {
          const [{ data: appliedRows }, { data: infoRows }] = await Promise.all([
            supabase
              .from("applications")
              .select("applicant_id")
              .eq("applicant_id", user.id)
              .eq("period_id", period.id)
              .in("status", ["submitted", "accepted", "rejected"])
              .limit(1),
            supabase.from("infosesh_attendance").select("applicant_id").eq("applicant_id", user.id).limit(1),
          ]);
          if (!appliedRows?.length) {
            setReapply({ periodName: period.name, infosessionDone: !!infoRows?.length });
          }
        }
      }

      // Load the portals this user can access plus enough to flag which ones
      // they're an admin of. RLS scopes the select, but exec's see-everything
      // access means the raw list ignores the simulated persona. So we also
      // gather the user's GENUINE memberships (portal rows, mapped roles, linked
      // projects) and — whenever the effective view isn't exec — filter the list
      // to those, so "view as PM/member" faithfully hides portals only exec sees.
      const [{ data: portalRows }, { data: memberRows }, { data: roleRows }, { data: portalRoleRows }, { data: myProjectRows }] =
        await Promise.all([
          supabase.from("portals").select("id, name, description, icon, icon_url, color, project_id").order("name"),
          supabase.from("portal_members").select("portal_id, is_admin, is_owner").eq("user_id", user.id),
          supabase.from("members_roles").select("role_id").eq("user_id", user.id),
          supabase.from("portal_roles").select("portal_id, role_id, is_admin"),
          supabase.from("project_members").select("project_id").eq("user_id", user.id),
        ]);

      const myRoleIds = new Set((roleRows ?? []).map((r) => r.role_id));
      const adminByRole = new Set(
        (portalRoleRows ?? [])
          .filter((pr) => pr.is_admin && myRoleIds.has(pr.role_id))
          .map((pr) => pr.portal_id),
      );
      const adminByRow = new Set(
        (memberRows ?? []).filter((m) => m.is_admin).map((m) => m.portal_id),
      );
      const ownerByRow = new Set(
        (memberRows ?? []).filter((m) => m.is_owner).map((m) => m.portal_id),
      );

      // Portals the user belongs to independent of exec's blanket access: a
      // portal_members row, a mapped role of any tier, or membership of the
      // linked project (covers project portals even if a managed row is missing).
      const myProjectIds = new Set((myProjectRows ?? []).map((r) => r.project_id));
      const memberByRow = new Set((memberRows ?? []).map((m) => m.portal_id));
      const memberByRole = new Set(
        (portalRoleRows ?? []).filter((pr) => myRoleIds.has(pr.role_id)).map((pr) => pr.portal_id),
      );
      const genuineIds = new Set<string>([
        ...memberByRow,
        ...memberByRole,
        ...(portalRows ?? [])
          .filter((p) => p.project_id && myProjectIds.has(p.project_id))
          .map((p) => p.id),
      ]);

      setPortals(
        (portalRows ?? [])
          .filter((p) => isExec || genuineIds.has(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            icon: p.icon,
            icon_url: p.icon_url,
            color: p.color,
            is_admin: isExec || adminByRow.has(p.id) || adminByRole.has(p.id),
            is_owner: ownerByRow.has(p.id),
          })),
      );
    };

    load();
  }, [router, ready, isExec, isBoardOrExec]);

  if (view === "checklist") {
    return <ApplicantChecklist completed={completed} simulating={simulating} persona={persona} />;
  }

  if (view === "dashboard") {
    return (
      <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
        {/* Board/exec get a shortcut into the application manager. A dark-gray
            pill; on hover white swipes in from the left (like the portal cards),
            the text inverts, and it scales up a hair. */}
        {isBoardOrExec && (
          <Link
            href="/manager"
            aria-label="Application Manager"
            className="group relative self-center inline-flex items-center gap-2 overflow-hidden rounded-full bg-neutral-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform duration-200 ease-out hover:scale-[1.03]"
          >
            {/* White accent wipes in from the left on hover. */}
            <span
              aria-hidden
              className="absolute inset-0 z-0 origin-left scale-x-0 bg-white transition-transform duration-300 ease-out group-hover:scale-x-100"
            />
            <span className="relative z-10 inline-flex items-center gap-2 whitespace-nowrap transition-colors duration-300 group-hover:text-neutral-900">
              <ShieldCheck size={18} className="shrink-0" />
              Application Manager
            </span>
          </Link>
        )}

        {firstName ? (
          <h1 className="text-3xl font-bold">{`Hi ${firstName}!`}</h1>
        ) : (
          <Skeleton className="h-9 w-48" />
        )}

        {reapply && (
          <div className="flex flex-col gap-3 rounded-xl border border-foreground/15 bg-foreground/[0.03] p-4">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold">Applications are open for {reapply.periodName}</h2>
              <p className="text-xs text-muted-foreground">
                Returning members re-apply each round. Complete the steps below to apply.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ReapplyStep label="Infosession" href="/infosession" done={reapply.infosessionDone} icon={Users} />
              <ReapplyStep label="Application" href="/application" done={false} icon={FileText} />
            </div>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Portals
              </h2>
            </div>
            {portals === null ? (
              <PortalGridSkeleton />
            ) : portals.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                You&apos;re not a member of any portals yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {portals.map((p) => (
                  <PortalCard key={p.id} portal={p} />
                ))}
              </div>
            )}
          </div>

          <div className="w-full lg:w-80 lg:flex-shrink-0 order-first lg:order-none">
            {/* On narrow screens the calendar moves above the content (below the
                title); CalendarPanel reads the current date, so a Suspense
                boundary keeps it out of the static shell (cacheComponents). */}
            <Suspense fallback={<CalendarSkeleton />}>
              <CalendarPanel />
            </Suspense>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      <Skeleton className="h-9 w-48" />
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <PortalGridSkeleton />
        </div>
        <div className="w-full lg:w-80 lg:flex-shrink-0">
          <CalendarSkeleton />
        </div>
      </div>
    </div>
  );
}

function ReapplyStep({
  label,
  href,
  done,
  icon: Icon,
  disabled,
}: {
  label: string;
  href: string;
  done: boolean;
  icon: React.ElementType;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled
        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm bg-background opacity-50 cursor-not-allowed"
      >
        <span className="h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 bg-foreground/5 text-foreground/70">
          <Icon size={14} />
        </span>
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">(closed)</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm bg-background hover:border-foreground/20 hover:shadow-sm transition-all"
    >
      <span
        className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          done ? "bg-green-600/10 text-green-700 dark:text-green-400" : "bg-foreground/5 text-foreground/70"
        }`}
      >
        {done ? <Check size={14} /> : <Icon size={14} />}
      </span>
      <span className="font-medium">{label}</span>
      <ArrowRight size={14} className="text-muted-foreground/50 group-hover:translate-x-0.5 group-hover:text-muted-foreground transition-all" />
    </Link>
  );
}

function ApplicantChecklist({
  completed,
  simulating,
  persona,
}: {
  completed: CompletionState;
  simulating: boolean;
  persona: string;
}) {
  const router = useRouter();

  const items = [
    { label: "Coffee Chat", description: "Meet a member and chat about the club.", href: "/coffee-chat", done: completed.coffeeChat, icon: Coffee },
    { label: "Infosession", description: "Attend an infosession to learn more.", href: "/infosession", done: completed.infosession, icon: Users },
    { label: "Application", description: "Submit your written application.", href: "/application", done: completed.application, icon: FileText },
  ];

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="flex flex-1 w-full items-center justify-center p-6">
      <div className="flex flex-col gap-8 w-full max-w-md">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Get involved</h1>
          <p className="text-sm text-muted-foreground">
            Complete the steps below to apply.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground transition-all duration-500"
                style={{ width: `${(doneCount / items.length) * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {doneCount}/{items.length}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {items.map(({ label, description, href, done, icon: Icon }) => (
              <button
                key={href}
                onClick={() => router.push(href)}
                className="group border rounded-xl px-4 py-3.5 flex items-center gap-3.5 text-left bg-background hover:border-foreground/20 hover:shadow-sm transition-all"
              >
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                    done ? "bg-green-600/10 text-green-700 dark:text-green-400" : "bg-foreground/5 text-foreground/70"
                  }`}
                >
                  {done ? <Check size={18} /> : <Icon size={18} />}
                </div>
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{description}</span>
                </div>
                <ArrowRight size={16} className="text-muted-foreground/50 flex-shrink-0 group-hover:translate-x-0.5 group-hover:text-muted-foreground transition-all" />
              </button>
            ))}
          </div>

          {simulating && persona === "member" && (
            <p className="text-xs text-muted-foreground italic text-center">
              Simulating member view.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
