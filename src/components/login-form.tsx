"use client";

import { EmailPasswordForm } from "@/components/email-password-form";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>Use your @berkeley.edu email to continue</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <GoogleSignInButton />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>
          <EmailPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
