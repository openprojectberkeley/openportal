import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsExec } from "@/lib/roles";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ManagerMenuSkeleton } from "@/components/skeletons";

// Reviewing is exec-only, and gated server-side rather than hidden in the UI —
// the same shape as the manager layout. `complete_resume_review()` and the
// resume_reviews SELECT policy enforce it again in the database, so this is
// about not rendering a queue someone can't act on, not about secrecy.
export default function ResumeReviewQueueLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ManagerMenuSkeleton />}>
      <ExecGuard>{children}</ExecGuard>
    </Suspense>
  );
}

async function ExecGuard({ children }: { children: React.ReactNode }) {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Honors the "view as" simulation cookie, so simulating a plain member is
  // actually blocked here.
  const accessLevels = await getEffectiveAccessLevels(supabase);

  if (!accessIsExec(accessLevels)) redirect("/resume-review");

  return <>{children}</>;
}
