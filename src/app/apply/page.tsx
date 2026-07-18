"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
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
    { label: "Coffee Chat", href: "/apply/coffee-chat", done: completed.coffeeChat },
    { label: "Infosession", href: "/apply/infosession", done: completed.infosession },
    { label: "Application", href: "/apply/application", done: completed.application },
  ];

  return (
    <>
      <div className="flex min-h-svh w-full items-center justify-center p-6">
        <div className="flex flex-col gap-6 w-full max-w-sm">
          {showApplicantFlow && (
            <>
              <h1 className="text-2xl font-bold">Get involved</h1>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-col gap-3">
                  {items.map(({ label, href, done }) => (
                    <button
                      key={href}
                      onClick={() => router.push(href)}
                      className="border rounded-md px-4 py-3 text-sm font-medium flex items-center justify-between hover:bg-accent transition-colors"
                    >
                      <span>{label}</span>
                      {done && <Check size={16} className="text-green-500 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
                {simulating && persona === "member" && (
                  <p className="text-xs text-muted-foreground italic">
                    Simulating member view.
                  </p>
                )}
              </div>
            </>
          )}

          {showApplicationManager && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                Handle coffee chats, infosession attendance, and applications.
              </p>
              <button
                onClick={() => router.push("/apply/manager")}
                className="bg-white text-black border rounded-md px-4 py-3 text-sm font-medium flex items-center justify-between hover:opacity-80 transition-opacity"
              >
                <span>Application Manager</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
