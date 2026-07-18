import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccessLevels } from "@/lib/roles-server";
import { accessIsBoardOrExec } from "@/lib/roles";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <ManagerGuard>{children}</ManagerGuard>
    </Suspense>
  );
}

async function ManagerGuard({ children }: { children: React.ReactNode }) {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Honors the VP Tech "view as" simulation cookie, so simulating a plain
  // member is actually blocked here (not just hidden in the UI).
  const accessLevels = await getEffectiveAccessLevels(supabase);

  if (!accessIsBoardOrExec(accessLevels)) redirect("/apply");

  return <>{children}</>;
}
