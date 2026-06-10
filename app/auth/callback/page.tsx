"use client";

import {
  BERKELEY_EMAIL_REQUIRED_MESSAGE,
  isBerkeleyEmail,
} from "@/lib/berkeley-email";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Signing you in...");

  useEffect(() => {
    const supabase = createClient();

    const finishSignIn = async () => {
      // detectSessionInUrl exchanges the OAuth code automatically when present.
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        router.replace(
          `/auth/error?error=${encodeURIComponent(error.message)}`,
        );
        return;
      }

      if (session) {
        if (!isBerkeleyEmail(session.user.email)) {
          await supabase.auth.signOut();
          router.replace(
            `/auth/error?error=${encodeURIComponent(BERKELEY_EMAIL_REQUIRED_MESSAGE)}`,
          );
          return;
        }

        router.replace("/protected");
        return;
      }

      router.replace(
        `/auth/error?error=${encodeURIComponent("Sign in failed")}`,
      );
    };

    finishSignIn().catch(() => {
      setMessage("Something went wrong. Redirecting...");
      router.replace("/auth/error?error=Sign in failed");
    });
  }, [router]);

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
