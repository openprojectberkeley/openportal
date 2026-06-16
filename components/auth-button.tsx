"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  type AccountInfo,
  subscribeToAccountInfo,
} from "@/lib/supabase/account";
import { LogoutButton } from "./logout-button";

export function AuthButton() {
  const [user, setUser] = useState<AccountInfo | null>(null);
  const firstName = user?.name?.split(" ")[0];

  useEffect(() => {
    const supabase = createClient();
    return subscribeToAccountInfo(supabase, setUser);
  }, []);

  return user ? (
    <div className="flex items-center gap-4">
      Hey, {firstName}!
      <LogoutButton />
    </div>
  ) : (
    <Button asChild size="sm" variant={"default"}>
      <Link href="/auth/login">Sign in</Link>
    </Button>
  );
}
