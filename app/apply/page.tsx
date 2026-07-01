"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

// Set to true to restrict "Get Involved" to non-board/exec members only.
// VP Tech can still see it (with a debug notice). Set to false to bypass.
const RESTRICT_TO_APPLICANTS = true;

// Must match the role_name value in the roles table exactly.
const VP_TECH_ROLE_NAME = "VP Tech";

type CompletionState = {
  coffeeChat: boolean;
  infosession: boolean;
  application: boolean;
};

export default function ApplyPage() {
  const router = useRouter();
  const [completed, setCompleted] = useState<CompletionState>({
    coffeeChat: false,
    infosession: false,
    application: false,
  });
  const [isBoardOrExec, setIsBoardOrExec] = useState(false);
  const [isVpTech, setIsVpTech] = useState(false);
  const [vpTechDebug, setVpTechDebug] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      const [
        { data: coffeeChat },
        { data: infosession },
        { data: application },
        { data: userRoles },
      ] = await Promise.all([
        supabase.from("coffee_chats").select("applicant_id").eq("applicant_id", user.id).eq("complete", true).maybeSingle(),
        supabase.from("infosesh_attendance").select("applicant_id").eq("applicant_id", user.id).maybeSingle(),
        supabase.from("applications").select("applicant_id").eq("applicant_id", user.id).maybeSingle(),
        supabase.from("members_roles").select("roles(role_name, access_level)").eq("user_id", user.id),
      ]);

      setCompleted({
        coffeeChat: !!coffeeChat,
        infosession: !!infosession,
        application: !!application,
      });

      const roles = (userRoles ?? []).flatMap((r: any) =>
        r.roles ? [r.roles] : []
      );
      const boardExec = roles.some(
        (r: any) => r.access_level === "board" || r.access_level === "exec"
      );
      const vpTech = roles.some((r: any) => r.role_name === VP_TECH_ROLE_NAME);
      setIsBoardOrExec(boardExec);
      setIsVpTech(vpTech);
    });
  }, []);

  const showApplicantFlow = !RESTRICT_TO_APPLICANTS || !isBoardOrExec || (isVpTech && vpTechDebug);
  const showApplicationManager = isBoardOrExec;

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
                {isVpTech && (
                  <p className="text-xs text-muted-foreground italic">
                    Available for debugging (VP Tech access).
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

      {isVpTech && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">applicant view</span>
          <button
            onClick={() => setVpTechDebug((v) => !v)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
              vpTechDebug ? "bg-foreground" : "bg-foreground/20"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform ${
                vpTechDebug ? "translate-x-4" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}
    </>
  );
}
