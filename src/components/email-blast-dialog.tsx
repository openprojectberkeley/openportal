"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { selectInChunks } from "@/lib/postgrest-chunk";

// One recipient, whichever cohort they came from. `email` may be null — those
// rows are counted in the intro line but never make it into the copyable list.
type Recipient = { user_id: string; email: string | null };

type Tab = "members" | "unfinished" | "acceptances";
const TABS: { key: Tab; label: string }[] = [
  { key: "members", label: "Active members" },
  { key: "unfinished", label: "Unfinished apps" },
  { key: "acceptances", label: "Acceptances" },
];

// Sentinel for "every drafted applicant, regardless of project" in the
// acceptances tab's project picker — same idiom as the applications page.
const ALL_PROJECTS = "__all__";

// A drafted applicant plus the project that confirmed them.
type Acceptance = Recipient & { project_id: string | null };
type ProjectOption = { id: string; name: string };

// Human-readable due date/time for the email script, in the reviewer's local time.
function formatDue(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Active-member blasts vary too much for a canned body, so this is a skeleton
// the sender fills in rather than a finished email.
function buildGenericScript(): string {
  return `Subject: [subject]

Hi all,

[your message here]

Best,
The Open Portal Team`;
}

function buildReminderScript(periodName: string, dueIso: string): string {
  const due = formatDue(dueIso);
  return `Subject: Reminder: your ${periodName} application is due ${due}

Hi there,

This is a friendly reminder that we don't have a completed application from you yet for ${periodName}. Applications are due ${due}.

If you're still interested, please log back in to the portal and finish submitting it before then — we'd hate for you to miss out because of an unfinished form.

If you've decided not to apply this cycle, no action is needed. If you have any questions, just reply to this email.

Best,
The Open Portal Team`;
}

// Acceptance email. Naming the project only works when the list is a single
// project's — the "All projects" list mixes placements, so it drops the name.
function buildAcceptanceScript(periodName: string, projectName: string | null): string {
  const placement = projectName
    ? `You've been accepted onto ${projectName}.`
    : `You've been accepted onto a project.`;
  return `Subject: You're in! ${periodName} results

Hi there,

Congratulations — ${placement} Thanks for putting the time into your application; we had a strong pool this cycle and we're excited to have you on the team.

Your project manager will be in touch shortly with kickoff details. In the meantime, log back in to the portal to see your project page.

If you have any questions, just reply to this email.

Best,
The Open Portal Team`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (non-secure context) — nothing to do.
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={copy}>
      {copied ? "Copied!" : label}
    </Button>
  );
}

// The two blocks every tab is made of: the comma-joined address list, and the
// script to paste into the mail client. Both are read-only and select-on-focus,
// since the whole dialog is a copy surface.
function RecipientsBlock({ emails }: { emails: string[] }) {
  const list = emails.join(", ");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recipients ({emails.length})
        </span>
        <CopyButton text={list} label="Copy emails" />
      </div>
      <textarea
        readOnly
        value={list}
        rows={4}
        className="w-full border rounded-md px-3 py-2 text-xs font-mono bg-muted resize-none focus:outline-none"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

function ScriptBlock({ script }: { script: string }) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Email script
        </span>
        <CopyButton text={script} label="Copy script" />
      </div>
      <textarea
        readOnly
        value={script}
        rows={10}
        className="w-full border rounded-md px-3 py-2 text-sm bg-muted resize-none focus:outline-none"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

// Shared shell for one tab: intro line, then loading/empty/loaded states.
// `rows === null` means "not fetched yet" (each tab loads lazily, on first view).
function TabBody({
  rows,
  error,
  intro,
  emptyLabel,
  script,
  children,
}: {
  rows: Recipient[] | null;
  error: string | null;
  intro: string;
  emptyLabel: string;
  script: string;
  children?: React.ReactNode;
}) {
  const emails = (rows ?? []).flatMap((r) => (r.email ? [r.email] : []));
  return (
    <div className="flex flex-col gap-4">
      {children}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {rows === null ? (
        <div className="flex flex-col gap-2">
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
          <div className="h-40 rounded-xl bg-muted animate-pulse" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground border rounded-xl">
          {emptyLabel}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {intro} {emails.length} of {rows.length} have an email on file.
          </p>
          <RecipientsBlock emails={emails} />
          <ScriptBlock script={script} />
        </>
      )}
    </div>
  );
}

// VP Tech/President-only dialog that assembles a copyable recipient list plus a
// matching script for one of three cohorts — every active member, everyone with
// an empty/unfinished application this period, and everyone this period's draft
// confirmed (per project, or all of them), who are the people the acceptance
// letter goes out to. It never sends anything.
export function EmailBlastDialog({
  open,
  onOpenChange,
  period,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: { id: string; name: string; ends_at: string };
}) {
  const [tab, setTab] = useState<Tab>("members");

  // One cache per cohort; null = not loaded yet, so each tab only queries the
  // first time it's opened. All three reset when the dialog opens or the period
  // changes.
  const [members, setMembers] = useState<Recipient[] | null>(null);
  const [drafts, setDrafts] = useState<Recipient[] | null>(null);
  const [acceptances, setAcceptances] = useState<Acceptance[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(ALL_PROJECTS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("members");
    setMembers(null);
    setDrafts(null);
    setAcceptances(null);
    setProjects([]);
    setSelectedProjectId(ALL_PROJECTS);
    setError(null);
  }, [open, period.id]);

  // Every active member. `members` is readable by any authenticated user, and
  // this dialog is already VP Tech/President-gated by the caller.
  const loadMembers = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("members")
      .select("user_id, email")
      .eq("status", "active");
    if (err) { setError(err.message); setMembers([]); return; }
    setMembers((data ?? []) as Recipient[]);
  }, []);

  // Empty/unfinished applications for this period (board/exec and PMs excluded
  // by the RPC itself).
  const loadDrafts = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("application_period_draft_applicants", {
      p_period_id: period.id,
    });
    if (err) { setError(err.message); setDrafts([]); return; }
    setDrafts((data ?? []) as Recipient[]);
  }, [period.id]);

  // Who this period's confirmation email goes to: everyone holding a CONFIRMED
  // draft pick, addressed by the project whose column they sit in. Not
  // `applications.status = 'accepted'` -- since 0092 that means the applicant
  // has already answered yes, i.e. the opposite of who still needs the letter
  // (and complete_draft no longer places anyone, so it would be empty anyway).
  // Anyone already marked rejected has declined and is dropped.
  const loadAcceptances = useCallback(async () => {
    const supabase = createClient();
    // Same nested shape as the ?project=all board's loadAll -- one round trip
    // for the period's whole draft.
    const { data, error: err } = await supabase
      .from("draft_round_projects")
      .select("project_id, submitted_at, draft_rounds!inner(period_id), draft_picks(application_id)")
      .eq("draft_rounds.period_id", period.id);
    if (err) { setError(err.message); setAcceptances([]); return; }
    const rounds = (data ?? []) as unknown as {
      project_id: string;
      submitted_at: string | null;
      draft_picks: { application_id: string }[];
    }[];

    // Application id -> the project that confirmed it. A staged pick is still
    // just a proposal, so only submitted round-projects count; the claimed
    // check (0088) means at most one project can confirm the same applicant,
    // and first-wins keeps a stray duplicate from double-listing them.
    const projectByAppId = new Map<string, string>();
    for (const rp of rounds) {
      if (!rp.submitted_at) continue;
      for (const pick of rp.draft_picks ?? []) {
        if (!projectByAppId.has(pick.application_id)) projectByAppId.set(pick.application_id, rp.project_id);
      }
    }

    const appRows = await selectInChunks<{ id: string; applicant_id: string; status: string }>(
      [...projectByAppId.keys()],
      (chunk) => supabase.from("applications").select("id, applicant_id, status").in("id", chunk),
    );
    const drafted = appRows.filter((a) => a.status !== "rejected");
    const ids = [...new Set(drafted.map((a) => a.applicant_id))];

    const [emailRows, projectRows] = await Promise.all([
      selectInChunks<{ user_id: string; email: string | null }>(ids, (chunk) =>
        supabase.from("members").select("user_id, email").in("user_id", chunk),
      ),
      supabase.from("projects").select("id, name").order("name"),
    ]);
    const emailById = new Map(emailRows.map((m) => [m.user_id, m.email]));

    const rows = drafted.map((a) => ({
      user_id: a.applicant_id,
      email: emailById.get(a.applicant_id) ?? null,
      project_id: projectByAppId.get(a.id) ?? null,
    }));
    setAcceptances(rows);
    // Only offer projects that actually drafted someone this period.
    const placed = new Set(rows.map((r) => r.project_id).filter(Boolean));
    setProjects(
      ((projectRows.data ?? []) as ProjectOption[]).filter((p) => placed.has(p.id)),
    );
  }, [period.id]);

  useEffect(() => {
    if (!open) return;
    if (tab === "members" && members === null) loadMembers();
    if (tab === "unfinished" && drafts === null) loadDrafts();
    if (tab === "acceptances" && acceptances === null) loadAcceptances();
  }, [open, tab, members, drafts, acceptances, loadMembers, loadDrafts, loadAcceptances]);

  const allProjects = selectedProjectId === ALL_PROJECTS;
  const selectedProjectName = projects.find((p) => p.id === selectedProjectId)?.name ?? null;
  const acceptanceRows =
    acceptances === null
      ? null
      : allProjects
        ? acceptances
        : acceptances.filter((a) => a.project_id === selectedProjectId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email blast — {period.name}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            This doesn&apos;t send anything — pick a group, then copy the recipients and the
            script and send it yourself.
          </p>

          <div className="flex gap-1 border-b">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "members" && (
            <TabBody
              rows={members}
              error={error}
              intro="Every member with an active status."
              emptyLabel="No active members."
              script={buildGenericScript()}
            />
          )}

          {tab === "unfinished" && (
            <TabBody
              rows={drafts}
              error={error}
              intro="Applicants with an empty or unfinished application for this period; board/exec and PMs are excluded."
              emptyLabel="No empty or unfinished applications for this period."
              script={buildReminderScript(period.name, period.ends_at)}
            />
          )}

          {tab === "acceptances" && (
            <TabBody
              rows={acceptanceRows}
              error={error}
              intro={
                allProjects
                  ? "Everyone drafted onto a project this period, minus anyone who has already declined."
                  : `Everyone drafted onto ${selectedProjectName ?? "this project"}, minus anyone who has already declined.`
              }
              emptyLabel={
                allProjects
                  ? "Nobody has been drafted for this period yet."
                  : "Nobody has been drafted onto this project yet."
              }
              script={buildAcceptanceScript(period.name, allProjects ? null : selectedProjectName)}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center justify-between gap-2 self-start rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent transition-colors min-w-[14rem]">
                    <span className="font-medium">
                      {allProjects ? "All projects" : selectedProjectName ?? "Select project"}
                    </span>
                    <ChevronDown size={14} className="text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setSelectedProjectId(ALL_PROJECTS)}>
                    All projects
                  </DropdownMenuItem>
                  {projects.length > 0 && <DropdownMenuSeparator />}
                  {projects.map((p) => (
                    <DropdownMenuItem key={p.id} onSelect={() => setSelectedProjectId(p.id)}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </TabBody>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
