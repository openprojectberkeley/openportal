export function getAuthCallbackUrl() {
  if (typeof window === "undefined") {
    return "/auth/callback";
  }

  return new URL(
    "/auth/callback",
    window.location.origin,
  ).href;
}

export function getPasswordResetRedirectUrl() {
  if (typeof window === "undefined") {
    return "/auth/update-password";
  }

  return new URL(
    "/auth/update-password",
    window.location.origin,
  ).href;
}
