const BERKELEY_EMAIL_DOMAIN = "berkeley.edu";

export const BERKELEY_EMAIL_REQUIRED_MESSAGE =
  "Only @berkeley.edu email addresses are allowed.";

export function isBerkeleyEmail(email: string | undefined | null) {
  if (!email) {
    return false;
  }

  return email.toLowerCase().endsWith(`@${BERKELEY_EMAIL_DOMAIN}`);
}
