"use client";

import { getAuthCallbackUrl } from "@/lib/auth-callback-url";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function GoogleSignInButton({ disabled }: { disabled?: boolean }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthCallbackUrl(),
        queryParams: {
          hd: "berkeley.edu",
        },
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled || isLoading}
        onClick={handleGoogleSignIn}
      >
        {isLoading ? "Redirecting..." : "Continue with Google"}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
