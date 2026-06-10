"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/client";
import { LogoutButton } from "./logout-button";

type UserClaims = {
  email?: string;
};

export function AuthButton() {
  const [user, setUser] = useState<UserClaims | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getClaims().then(({ data }) => {
      setUser(data?.claims ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { email: session.user.email } : null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return user ? (
    <div className="flex items-center gap-4">
      Hey, {user.email}!
      <LogoutButton />
    </div>
  ) : (
    <Button asChild size="sm" variant={"default"}>
      <Link href="/auth/login">Sign in</Link>
    </Button>
  );
}
