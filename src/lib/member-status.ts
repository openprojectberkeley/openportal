// Pure predicates mirroring the member-status rules enforced in the database
// (supabase/migrations/0042_member_status_enum.sql: is_returning_member(),
// accept_application()'s Studio-eligibility guard, and set_member_status()).
// The database is the source of truth for authorization — these exist to
// document the same rules in one place and to power client-side view/gating
// logic without a round trip. Keep them in sync with the migration.

export type MemberStatus = "active" | "inactive" | "non_member" | "blacklisted";

export const MEMBER_STATUS_VALUES: MemberStatus[] = ["active", "inactive", "non_member", "blacklisted"];

// Mirrors is_returning_member() and the accept_application() Studio guard:
// status in ('active', 'inactive'). A rolled-off (inactive) member still
// counts as "has been an accepted member before".
export function isReturningMember(status: MemberStatus | null | undefined): boolean {
  return status === "active" || status === "inactive";
}

// Mirrors the (app)/page.tsx dashboard-vs-checklist split: only a true
// first-time applicant (non_member, non-staff) sees the checklist. Anyone
// who's ever been a member (active/inactive/blacklisted) and board/exec see
// the dashboard.
export function getHomeView(
  status: MemberStatus,
  isBoardOrExec: boolean,
): "dashboard" | "checklist" {
  if (status === "non_member" && !isBoardOrExec) return "checklist";
  return "dashboard";
}

// Mirrors the (app)/page.tsx re-apply banner: only a currently-active,
// non-staff member is prompted to re-apply each open round.
export function shouldShowReapplyBanner(status: MemberStatus, isBoardOrExec: boolean): boolean {
  return status === "active" && !isBoardOrExec;
}

// Profile-modal badge copy. No entry for "active" — the default, unremarkable
// state renders no badge.
export const MEMBER_STATUS_BADGE_LABEL: Partial<Record<MemberStatus, string>> = {
  inactive: "Inactive",
  non_member: "Applicant",
  blacklisted: "Blacklisted",
};

// Admin members-tab display copy (every status gets a visible label there).
export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  non_member: "Non-member",
  blacklisted: "Blacklisted",
};
