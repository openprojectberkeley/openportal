import { createClient } from "@/lib/supabase/server";
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

  const { data: roleData } = await supabase
    .from("members_roles")
    .select("roles(access_level)")
    .eq("user_id", user.id);

  const isBoardOrExec = (roleData ?? []).some(
    (r: any) => r.roles?.access_level === "board" || r.roles?.access_level === "exec"
  );

  if (!isBoardOrExec) redirect("/apply");

  return <>{children}</>;
}
