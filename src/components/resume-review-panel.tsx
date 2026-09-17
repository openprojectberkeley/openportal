"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock, FileSearch } from "lucide-react";

type State =
  | { kind: "none" }
  | { kind: "pending"; since: string }
  | { kind: "ready"; on: string };

// Home-page entry point for resume review. The service is available any time and
// is NOT part of the application, so this panel stands on its own rather than
// joining the applicant checklist — it just reflects whatever the person's most
// recent request is doing and links into /resume-review.
export function ResumeReviewPanel() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: rows } = await supabase
        .from("resume_reviews")
        .select("status, created_at, completed_at")
        .eq("requester_id", user.id)
        .in("status", ["pending", "completed"])
        .order("created_at", { ascending: false })
        .limit(1);

      const latest = rows?.[0];
      if (!latest) setState({ kind: "none" });
      else if (latest.status === "pending") setState({ kind: "pending", since: latest.created_at });
      else setState({ kind: "ready", on: latest.completed_at ?? latest.created_at });
    };
    load();
  }, []);

  // Nothing until we know — avoids a flash of "request one" for someone who
  // already has feedback waiting.
  if (state === null) return null;

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const copy =
    state.kind === "pending"
      ? { title: "Resume review in progress", body: `Requested ${date(state.since)} — we'll notify you when feedback is ready.`, cta: "View request", Icon: Clock }
      : state.kind === "ready"
        ? { title: "Your resume feedback is ready", body: `Reviewed ${date(state.on)}.`, cta: "Read feedback", Icon: Check }
        : { title: "Want feedback on your resume?", body: "Ask a member of our team to look it over — any time, no application needed.", cta: "Request a review", Icon: FileSearch };

  const { title, body, cta, Icon } = copy;

  return (
    <Link
      href="/resume-review"
      className="group flex items-center gap-3.5 rounded-xl border border-foreground/15 bg-foreground/[0.03] p-4 hover:border-foreground/25 hover:shadow-sm transition-all"
    >
      <span
        className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          state.kind === "ready"
            ? "bg-green-600/10 text-green-700 dark:text-green-400"
            : "bg-foreground/5 text-foreground/70"
        }`}
      >
        <Icon size={18} />
      </span>
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{body}</span>
      </div>
      <span className="hidden sm:inline text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap">
        {cta}
      </span>
      <ArrowRight size={16} className="text-muted-foreground/50 flex-shrink-0 group-hover:translate-x-0.5 group-hover:text-muted-foreground transition-all" />
    </Link>
  );
}
