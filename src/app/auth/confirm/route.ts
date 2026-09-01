import {
  BERKELEY_EMAIL_REQUIRED_MESSAGE,
  isBerkeleyEmail,
} from "@/lib/berkeley-email";
import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

function errorUrl(message: string) {
  return `/auth/error?error=${encodeURIComponent(message)}`;
}

// Email confirmation (sign-up, magic link, recovery) lands here. Unlike the
// PKCE `?code=` flow used for OAuth, verifyOtp with a token_hash needs no
// browser-stored code verifier, so it works when the link is opened on a
// different device or browser than the one that started sign-up.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!token_hash || !type) {
    redirect(errorUrl("Email link is invalid or has expired."));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error || !data.user) {
    redirect(errorUrl(error?.message ?? "Email link is invalid or has expired."));
  }

  if (!isBerkeleyEmail(data.user.email)) {
    await supabase.auth.signOut();
    redirect(errorUrl(BERKELEY_EMAIL_REQUIRED_MESSAGE));
  }

  // Password recovery links must land on the set-new-password screen, not be
  // dropped straight into the app.
  if (type === "recovery") {
    redirect("/auth/update-password");
  }

  const { data: member } = await supabase
    .from("members")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  redirect(member ? "/" : "/onboarding");
}
