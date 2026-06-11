import {
  BERKELEY_EMAIL_REQUIRED_MESSAGE,
  isBerkeleyEmail,
} from "@/lib/berkeley-email";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

function isAuthCallbackPath(pathname: string) {
  return pathname === "/auth/callback" || pathname === "/auth/callback/";
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  if (!hasEnvVars) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // OAuth callback: exchange the code on the server so the PKCE verifier
  // cookie (set when sign-in started) is read from the request cookies.
  if (isAuthCallbackPath(request.nextUrl.pathname)) {
    const code = request.nextUrl.searchParams.get("code");
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.search = "";

      if (error) {
        redirectUrl.pathname = "/auth/error";
        redirectUrl.searchParams.set("error", error.message);
      } else if (!isBerkeleyEmail(data.session?.user.email)) {
        await supabase.auth.signOut();
        redirectUrl.pathname = "/auth/error";
        redirectUrl.searchParams.set("error", BERKELEY_EMAIL_REQUIRED_MESSAGE);
      } else {
        redirectUrl.pathname = "/protected";
      }

      const redirectResponse = NextResponse.redirect(redirectUrl);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie);
      });
      return redirectResponse;
    }

    return supabaseResponse;
  }

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user && !request.nextUrl.pathname.startsWith("/auth")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
