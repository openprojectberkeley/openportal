import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRoleNames } from "@/lib/roles-server";
import { canReviewAllProjects } from "@/lib/roles";

export default async function DraftPage() {
  await connection();
  const supabase = await createClient();

  // Same three roles that get cross-project application review (VP
  // Tech/President/VP Projects) — narrower than the manager/layout.tsx
  // board-or-exec guard, so it's enforced again here.
  const roleNames = await getEffectiveRoleNames(supabase);
  if (!canReviewAllProjects(roleNames.map((role_name) => ({ role_name })))) redirect("/manager");

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <Link href="/manager" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="text-2xl font-bold">Draft</h1>
        <p className="text-sm text-muted-foreground">
          Draft accepted members onto new projects.
        </p>
      </div>

      <div className="px-4 py-10 text-center text-sm text-muted-foreground border rounded-xl">
        Coming soon.
      </div>
    </div>
  );
}
