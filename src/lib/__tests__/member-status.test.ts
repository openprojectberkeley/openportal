// Unit tests for src/lib/member-status.ts — the client-side mirror of the
// status rules enforced by supabase/migrations/0042_member_status_enum.sql
// (is_returning_member(), accept_application()'s Studio guard, and the
// dashboard/checklist/re-apply/badge logic in the app). Exhaustive over all
// 4 member_status values crossed with the relevant board/exec flag, so every
// branch this migration touches is asserted here.

import { describe, it, expect } from "vitest";
import {
  MEMBER_STATUS_VALUES,
  MEMBER_STATUS_BADGE_LABEL,
  MEMBER_STATUS_LABEL,
  isReturningMember,
  getHomeView,
  shouldShowReapplyBanner,
  type MemberStatus,
} from "@/lib/member-status";

describe("MEMBER_STATUS_VALUES", () => {
  it("lists exactly the 4 states in the DB enum, matching migration 0042's create type", () => {
    expect(MEMBER_STATUS_VALUES).toEqual(["active", "inactive", "non_member", "blacklisted"]);
  });
});

describe("isReturningMember", () => {
  // Mirrors: select exists(... where m.status in ('active', 'inactive'))
  it("is true for active", () => {
    expect(isReturningMember("active")).toBe(true);
  });

  it("is true for inactive (a rolled-off member still counts as returning)", () => {
    expect(isReturningMember("inactive")).toBe(true);
  });

  it("is false for non_member (a true first-timer)", () => {
    expect(isReturningMember("non_member")).toBe(false);
  });

  it("is false for blacklisted", () => {
    expect(isReturningMember("blacklisted")).toBe(false);
  });

  it("is false for null/undefined (no member row yet)", () => {
    expect(isReturningMember(null)).toBe(false);
    expect(isReturningMember(undefined)).toBe(false);
  });
});

describe("getHomeView", () => {
  // Only a true first-time applicant (non_member), and only when they're not
  // board/exec, sees the checklist. Every other combination is the dashboard.
  const cases: [MemberStatus, boolean, "dashboard" | "checklist"][] = [
    ["non_member", false, "checklist"],
    ["non_member", true, "dashboard"],
    ["active", false, "dashboard"],
    ["active", true, "dashboard"],
    ["inactive", false, "dashboard"],
    ["inactive", true, "dashboard"],
    ["blacklisted", false, "dashboard"],
    ["blacklisted", true, "dashboard"],
  ];

  for (const [status, isBoardOrExec, expected] of cases) {
    it(`status=${status} isBoardOrExec=${isBoardOrExec} -> ${expected}`, () => {
      expect(getHomeView(status, isBoardOrExec)).toBe(expected);
    });
  }
});

describe("shouldShowReapplyBanner", () => {
  // Any returning (active or rolled-off/inactive), non-staff member gets the
  // re-apply prompt.
  const cases: [MemberStatus, boolean, boolean][] = [
    ["active", false, true],
    ["active", true, false],
    ["inactive", false, true],
    ["inactive", true, false],
    ["non_member", false, false],
    ["non_member", true, false],
    ["blacklisted", false, false],
    ["blacklisted", true, false],
  ];

  for (const [status, isBoardOrExec, expected] of cases) {
    it(`status=${status} isBoardOrExec=${isBoardOrExec} -> ${expected}`, () => {
      expect(shouldShowReapplyBanner(status, isBoardOrExec)).toBe(expected);
    });
  }
});

describe("MEMBER_STATUS_BADGE_LABEL (profile modal)", () => {
  it("has no entry for active (no badge shown)", () => {
    expect(MEMBER_STATUS_BADGE_LABEL.active).toBeUndefined();
  });

  it("labels inactive, non_member, and blacklisted", () => {
    expect(MEMBER_STATUS_BADGE_LABEL.inactive).toBe("Inactive");
    expect(MEMBER_STATUS_BADGE_LABEL.non_member).toBe("Applicant");
    expect(MEMBER_STATUS_BADGE_LABEL.blacklisted).toBe("Blacklisted");
  });
});

describe("MEMBER_STATUS_LABEL (admin display)", () => {
  it("labels every status, including active", () => {
    for (const status of MEMBER_STATUS_VALUES) {
      expect(MEMBER_STATUS_LABEL[status]).toBeTruthy();
    }
    expect(MEMBER_STATUS_LABEL.active).toBe("Active");
    expect(MEMBER_STATUS_LABEL.inactive).toBe("Inactive");
    expect(MEMBER_STATUS_LABEL.non_member).toBe("Non-member");
    expect(MEMBER_STATUS_LABEL.blacklisted).toBe("Blacklisted");
  });
});
