"use client";

import { getPasswordResetRedirectUrl } from "@/lib/auth-callback-url";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState, type FormEvent } from "react";

const EMAIL_DOMAIN = "berkeley.edu";

export function ForgotPasswordForm() {
  const [localPart, setLocalPart] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedLocalPart = localPart.trim();
    if (!trimmedLocalPart) {
      setError("Enter your Berkeley username.");
      return;
    }
    const email = `${trimmedLocalPart}@${EMAIL_DOMAIN}`;

    setIsLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(),
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }

    // Show the same confirmation regardless of whether the account exists,
    // so this form can't be used to enumerate accounts.
    setSentTo(email);
    setIsLoading(false);
  };

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          If an account exists for {sentTo}, we sent a link to reset your
          password.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/auth/login">Back to sign in</Link>
        </Button>
      </div>
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
            disabled={isLoading}
            value={localPart}
            onChange={(event) =>
              setLocalPart(event.target.value.replace(/[@\s].*$/, ""))
            }
            className="rounded-none border-0 shadow-none focus-visible:ring-0"
            placeholder="username"
          />
          <span className="flex items-center whitespace-nowrap border-l border-input bg-muted px-3 text-sm text-muted-foreground">
            @{EMAIL_DOMAIN}
          </span>
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Please wait..." : "Send reset link"}
      </Button>
      <Link
        href="/auth/login"
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Back to sign in
      </Link>
    </form>
  );
}
