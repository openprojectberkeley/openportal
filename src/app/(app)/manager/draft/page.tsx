import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRoleNames } from "@/lib/roles-server";
import { canReviewAllProjects } from "@/lib/roles";
import { DraftRoundsManager } from "@/components/draft-rounds-manager";
import { BackLink } from "@/components/back-link";
import { InfoHint } from "@/components/ui/info-hint";

export default async function DraftPage() {
  await connection();
  const supabase = await createClient();

  // Same three roles that get cross-project application review (VP
  // Tech/President/VP Projects) — narrower than the manager/layout.tsx
  // board-or-exec guard, so it's enforced again here.
  const roleNames = await getEffectiveRoleNames(supabase);
  if (!canReviewAllProjects(roleNames.map((role_name) => ({ role_name })))) redirect("/manager");

  return (
    <div className="w-full max-w-6xl mx-auto p-6 flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <BackLink href="/manager/applications?project=all" label="Applications" />
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Draft</h1>
          <InfoHint label="About the draft">
            Set up draft rounds: the order projects pick in and how many applicants each may take, per round.
          </InfoHint>
        </div>
      </div>

      <DraftRoundsManager />
    </div>
  );
}
