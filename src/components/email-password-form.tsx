"use client";

import { getAuthCallbackUrl } from "@/lib/auth-callback-url";
import {
  BERKELEY_EMAIL_REQUIRED_MESSAGE,
  isBerkeleyEmail,
} from "@/lib/berkeley-email";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Mode = "sign-in" | "sign-up";

export function EmailPasswordForm({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(
    null,
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!isBerkeleyEmail(email)) {
      setError(BERKELEY_EMAIL_REQUIRED_MESSAGE);
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    if (mode === "sign-up") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: getAuthCallbackUrl() },
      });

      if (error) {
        setError(error.message);
        setIsLoading(false);
        return;
      }

      setConfirmationSentTo(email);
      setIsLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    router.replace("/");
  };

  if (confirmationSentTo) {
    return (
      <p className="text-sm text-muted-foreground">
        Check {confirmationSentTo} for a confirmation link to finish signing
        up.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          disabled={disabled || isLoading}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete={
            mode === "sign-up" ? "new-password" : "current-password"
          }
          required
          minLength={6}
          disabled={disabled || isLoading}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" className="w-full" disabled={disabled || isLoading}>
        {isLoading
          ? "Please wait..."
          : mode === "sign-up"
            ? "Sign up"
            : "Sign in"}
      </Button>
      <button
        type="button"
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        disabled={isLoading}
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
        }}
      >
        {mode === "sign-in"
          ? "Need an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
