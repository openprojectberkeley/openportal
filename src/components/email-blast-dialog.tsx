"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type DraftState = "empty" | "unfinished";

type DraftApplicant = {
  user_id: string;
  preferred_firstname: string | null;
  lastname: string | null;
  email: string | null;
  draft_state: DraftState;
};

function applicantName(a: DraftApplicant): string {
  return [a.preferred_firstname, a.lastname].filter(Boolean).join(" ") || "Applicant";
}

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

function buildEmailScript(periodName: string, dueIso: string): string {
  const due = formatDue(dueIso);
  return `Subject: Reminder: your ${periodName} application is due ${due}

Hi there,

This is a friendly reminder that we don't have a completed application from you yet for ${periodName}. Applications are due ${due}.

If you're still interested, please log back in to the portal and finish submitting it before then — we'd hate for you to miss out because of an unfinished form.

If you've decided not to apply this cycle, no action is needed. If you have any questions, just reply to this email.

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

// Exec-only dialog listing everyone with an empty/unfinished draft application
// for a period (PMs and board/exec excluded), plus a ready-to-copy reminder
// email so the manager can send the blast themselves — this never sends email.
export function EmailBlastDialog({
  open,
  onOpenChange,
  period,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: { id: string; name: string; ends_at: string };
}) {
  const [rows, setRows] = useState<DraftApplicant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    (async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("application_period_draft_applicants", {
        p_period_id: period.id,
      });
      if (err) { setError(err.message); return; }
      setRows((data ?? []) as DraftApplicant[]);
    })();
  }, [open, period.id]);

  const withEmail = (rows ?? []).filter((r) => r.email);
  const emailList = withEmail.map((r) => r.email).join(", ");
  const script = buildEmailScript(period.name, period.ends_at);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email blast — {period.name}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Applicants with an empty or unfinished application for this period. Board/exec and
            PMs are excluded. This doesn&apos;t send anything — copy the recipients and script
            below and send it yourself.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {rows === null ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground border rounded-xl">
              No empty or unfinished applications for this period.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((r) => (
                <div key={r.user_id} className="flex items-center gap-3 border rounded-xl px-4 py-2.5">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium truncate">{applicantName(r)}</span>
                    <span className="text-xs text-muted-foreground truncate">{r.email ?? "No email on file"}</span>
                  </div>
                  <Badge variant={r.draft_state === "empty" ? "secondary" : "outline"}>
                    {r.draft_state === "empty" ? "Empty" : "Unfinished"}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {rows !== null && withEmail.length > 0 && (
            <div className="flex flex-col gap-3 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recipients ({withEmail.length})
                </span>
                <CopyButton text={emailList} label="Copy emails" />
              </div>
              <textarea
                readOnly
                value={emailList}
                rows={2}
                className="w-full border rounded-md px-3 py-2 text-xs font-mono bg-muted resize-none focus:outline-none"
                onFocus={(e) => e.currentTarget.select()}
              />

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reminder email
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
