"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Coffee, FileText, Users, ArrowRight, ShieldCheck } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";

type CompletionState = {
  coffeeChat: boolean;
  infosession: boolean;
  application: boolean;
};

export default function ApplyPage() {
  const router = useRouter();
  const { ready, isBoardOrExec, simulating, persona } = useRoleSim();
  const [completed, setCompleted] = useState<CompletionState>({
    coffeeChat: false,
    infosession: false,
    application: false,
  });

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      const [
        { data: coffeeChat },
        { data: infosession },
        { data: application },
      ] = await Promise.all([
        supabase.from("coffee_chats").select("applicant_id").eq("applicant_id", user.id).eq("complete", true).maybeSingle(),
        supabase.from("infosesh_attendance").select("applicant_id").eq("applicant_id", user.id).maybeSingle(),
        supabase.from("applications").select("applicant_id").eq("applicant_id", user.id).maybeSingle(),
      ]);

      setCompleted({
        coffeeChat: !!coffeeChat,
        infosession: !!infosession,
        application: !!application,
      });
    });
  }, []);

  // Members see the applicant flow; board/exec see the manager entry instead.
  const showApplicantFlow = ready && !isBoardOrExec;
  const showApplicationManager = ready && isBoardOrExec;

  const items = [
    { label: "Coffee Chat", description: "Meet a member and chat about the club.", href: "/apply/coffee-chat", done: completed.coffeeChat, icon: Coffee },
    { label: "Infosession", description: "Attend an infosession to learn more.", href: "/apply/infosession", done: completed.infosession, icon: Users },
    { label: "Application", description: "Submit your written application.", href: "/apply/application", done: completed.application, icon: FileText },
  ];

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="flex min-h-[calc(100svh-4rem)] w-full items-center justify-center p-6">
      <div className="flex flex-col gap-8 w-full max-w-md">
        {showApplicantFlow && (
          <>
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
          </>
        )}

        {showApplicationManager && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5 text-center">
              <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
              <p className="text-sm text-muted-foreground">
                Handle coffee chats, infosession attendance, and applications.
              </p>
            </div>
            <button
              onClick={() => router.push("/apply/manager")}
              className="group border rounded-xl px-4 py-3.5 flex items-center gap-3.5 text-left bg-foreground text-background hover:opacity-90 transition-opacity"
            >
              <div className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 bg-background/10">
                <ShieldCheck size={18} />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-sm font-medium">Application Manager</span>
                <span className="text-xs text-background/70">Review and manage applicants.</span>
              </div>
              <ArrowRight size={16} className="text-background/60 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
