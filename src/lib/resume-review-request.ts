// Pure checks for /api/resume-reviews, kept separate so they can be unit tested.

const MAX_TARGET_ROLES = 1000;
const PDF_HEADER_WINDOW = 1024;

export const UPLOAD_A_PDF = "Upload a PDF to request a review.";

export type ReviewRequestFields = { targetRoles: string | null; neededBy: string | null };

export function parseReviewRequest(body: unknown): ReviewRequestFields | null {
  if (typeof body !== "object" || body === null) return null;
  const { targetRoles, neededBy } = body as Record<string, unknown>;

  if (targetRoles != null && (typeof targetRoles !== "string" || targetRoles.length > MAX_TARGET_ROLES)) return null;
  if (neededBy != null && (typeof neededBy !== "string" || !isCalendarDate(neededBy))) return null;

  return {
    targetRoles: (targetRoles as string | null | undefined)?.trim() || null,
    neededBy: (neededBy as string | null | undefined) || null,
  };
}

function isCalendarDate(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** PDF readers accept the `%PDF-` marker anywhere in the first kilobyte. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, PDF_HEADER_WINDOW));
  return head.includes("%PDF-");
}
