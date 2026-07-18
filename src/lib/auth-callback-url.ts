export function getAuthCallbackUrl() {
  if (typeof window === "undefined") {
    return "/auth/callback";
  }

  return new URL(
    "/auth/callback",
    window.location.origin,
  ).href;
}
