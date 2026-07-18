"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BERKELEY_EMAIL_REQUIRED_MESSAGE } from "@/lib/berkeley-email";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const isBerkeleyEmailError = error === BERKELEY_EMAIL_REQUIRED_MESSAGE;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="text-sm text-muted-foreground">Code error: {error}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          An unspecified error occurred.
        </p>
      )}
      {isBerkeleyEmailError && (
        <Button asChild className="w-full">
          <Link href="/auth/login">Back to sign in</Link>
        </Button>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Sorry, something went wrong.
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense>
                <ErrorContent />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
