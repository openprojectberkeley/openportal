"use client";

import { getAuthCallbackUrl } from "@/lib/auth-callback-url";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Mode = "sign-in" | "sign-up";

const EMAIL_DOMAIN = "berkeley.edu";

export function EmailPasswordForm({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [localPart, setLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(
    null,
  );
  const [existingAccount, setExistingAccount] = useState<
    null | "google" | "password"
  >(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setExistingAccount(null);

    const trimmedLocalPart = localPart.trim();
    if (!trimmedLocalPart) {
      setError("Enter your Berkeley username.");
      return;
    }
    const email = `${trimmedLocalPart}@${EMAIL_DOMAIN}`;

    setIsLoading(true);
    const supabase = createClient();

    if (mode === "sign-up") {
      // Steer returning users to the right sign-in method before creating an
      // account. With email-enumeration protection on, signUp for an email that
      // already exists silently no-ops (no confirmation email is sent), so
      // without this pre-check the form would wrongly tell them to check their
      // inbox. Most accounts here were created with Google, so distinguish that.
      const { data: statusRows } = await supabase.rpc("account_exists", {
        p_email: email,
      });
      const status = (
        Array.isArray(statusRows) ? statusRows[0] : statusRows
      ) as
        | { found: boolean; has_password: boolean; has_google: boolean }
        | null
        | undefined;
      if (status?.found) {
        setExistingAccount(
          status.has_google && !status.has_password ? "google" : "password",
        );
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: getAuthCallbackUrl() },
      });

      if (error) {
        setError(error.message);
        setIsLoading(false);
        return;
      }

      // If email confirmation is off, signUp already returns a live session
      // instead of requiring a click-through, so there's nothing to "check
      // your email" for.
      if (data.session) {
        router.replace("/");
        return;
      }

      // Fallback for a race (account created between the check above and here)
      // or if enumeration protection is toggled off later: enumeration
      // protection returns a user with an empty identities array rather than an
      // error when the email already exists.
      if ((data.user?.identities?.length ?? 0) === 0) {
        setExistingAccount("password");
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
        <Label htmlFor="email">Berkeley email</Label>
        <div className="flex items-stretch overflow-hidden rounded-md border border-input has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-ring">
          <Input
            id="email"
            type="text"
            autoComplete="username"
            required
            disabled={disabled || isLoading}
            value={localPart}
            onChange={(event) => {
              setLocalPart(event.target.value.replace(/[@\s].*$/, ""));
              setExistingAccount(null);
            }}
            className="rounded-none border-0 shadow-none focus-visible:ring-0"
            placeholder="username"
          />
          <span className="flex items-center whitespace-nowrap border-l border-input bg-muted px-3 text-sm text-muted-foreground">
            @{EMAIL_DOMAIN}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete={
              mode === "sign-up" ? "new-password" : "current-password"
            }
            required
            minLength={6}
            disabled={disabled || isLoading}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="pr-9"
          />
          <button
            type="button"
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {existingAccount && (
        <div className="flex flex-col gap-2 rounded-md border border-input bg-muted/50 p-3 text-sm">
          <p className="text-muted-foreground">
            {existingAccount === "google"
              ? "This email already has an account created with Google. Use the “Continue with Google” button above to sign in."
              : "An account with this email already exists. Sign in with your password instead."}
          </p>
          <button
            type="button"
            className="self-start font-medium underline underline-offset-4 hover:text-foreground"
            onClick={() => {
              setMode("sign-in");
              setExistingAccount(null);
              setError(null);
            }}
          >
            Sign in instead
          </button>
        </div>
      )}
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
          setExistingAccount(null);
        }}
      >
        {mode === "sign-in"
          ? "Need an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
