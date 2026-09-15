// Shared rules for a portal's free-form markdown page (portals.content, 0089).

// Mirrors the portals_content_length_check constraint. Checked client-side too
// so an over-long paste surfaces as a readable message instead of a raw
// Postgres constraint-violation string in the save error line.
export const MAX_PORTAL_CONTENT = 100000;

// What actually gets written to the column: trimmed, with blank collapsing to
// null so "never written" and "cleared" are the same state. Matches how
// icon/color/description are normalized in portal-settings-modal.tsx.
export function normalizePortalContent(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// True when the editor holds unsaved edits. Compares normalized forms so
// trailing-whitespace churn doesn't trigger the discard prompt.
export function hasUnsavedContent(draft: string, saved: string | null): boolean {
  return normalizePortalContent(draft) !== (saved ?? null);
}
