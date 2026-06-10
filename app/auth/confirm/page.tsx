"use client";

import { createClient } from "@/lib/supabase/client";
import { type EmailOtpType } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Confirming your account...");

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type") as EmailOtpType | null;
    const next = searchParams.get("next") ?? "/";

    if (!tokenHash || !type) {
      router.replace("/auth/error?error=No token hash or type");
      return;
    }

    const supabase = createClient();

    supabase.auth
      .verifyOtp({ type, token_hash: tokenHash })
      .then(({ error }) => {
        if (error) {
          router.replace(`/auth/error?error=${encodeURIComponent(error.message)}`);
          return;
        }

        router.replace(next);
      })
      .catch(() => {
        setMessage("Something went wrong. Redirecting...");
        router.replace("/auth/error?error=Confirmation failed");
      });
  }, [router, searchParams]);

  return (
    <p className="text-sm text-muted-foreground">{message}</p>
  );
}

export default function ConfirmPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <Suspense>
        <ConfirmContent />
      </Suspense>
    </div>
  );
}
