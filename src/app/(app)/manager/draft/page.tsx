import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRoleNames } from "@/lib/roles-server";
import { canReviewAllProjects } from "@/lib/roles";
import { DraftRoundsManager } from "@/components/draft-rounds-manager";

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
        <Link href="/manager/applications?project=all" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Draft</h1>
        <p className="text-sm text-muted-foreground">
          Set up draft rounds: the order projects pick in and how many applicants each may take, per round.
        </p>
      </div>

      <DraftRoundsManager />
    </div>
  );
}
