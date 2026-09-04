// Unit tests for src/lib/roles.ts's pure helpers. hasElevatedRole is the
// mechanism behind supabase/migrations/0047_president_vp_tech_parity.sql:
// VP Tech and President share the "view as" simulation toggle and (via the
// matching is_vp_tech_or_president() DB combinator) coffee-chat window admin.
// Keep this in sync with that migration's role-name list.

import { describe, it, expect } from "vitest";
import {
  ELEVATED_ROLE_NAMES,
  VP_TECH_ROLE_NAME,
  PRESIDENT_ROLE_NAME,
  VP_PROJECTS_ROLE_NAME,
  FULL_ACCESS_REVIEW_ROLE_NAMES,
  hasElevatedRole,
  canReviewAllProjects,
  isPersona,
  accessIsBoardOrExec,
  accessIsExec,
  personaFromAccessLevels,
} from "@/lib/roles";

describe("ELEVATED_ROLE_NAMES", () => {
  it("is exactly VP Tech and President, matching migration 0047's is_vp_tech_or_president()", () => {
    expect(ELEVATED_ROLE_NAMES).toEqual(["VP Tech", "President"]);
    expect(ELEVATED_ROLE_NAMES).toContain(VP_TECH_ROLE_NAME);
    expect(ELEVATED_ROLE_NAMES).toContain(PRESIDENT_ROLE_NAME);
  });
});

describe("hasElevatedRole", () => {
  it("is true for VP Tech", () => {
    expect(hasElevatedRole([{ role_name: "VP Tech" }])).toBe(true);
  });

  it("is true for President", () => {
    expect(hasElevatedRole([{ role_name: "President" }])).toBe(true);
  });

  it("is true when the elevated role is one of several", () => {
    expect(
      hasElevatedRole([{ role_name: "Member" }, { role_name: "PM" }, { role_name: "President" }]),
    ).toBe(true);
  });

  it("is false for other exec-tier roles (e.g. VP Projects) — access_level alone doesn't grant it", () => {
    expect(hasElevatedRole([{ role_name: "VP Projects" }])).toBe(false);
  });

  it("is false for an empty role list", () => {
    expect(hasElevatedRole([])).toBe(false);
  });

  it("is false when every role_name is null", () => {
    expect(hasElevatedRole([{ role_name: null }, { role_name: null }])).toBe(false);
  });

  it("does not false-positive on a substring/case match", () => {
    expect(hasElevatedRole([{ role_name: "vp tech" }])).toBe(false);
    expect(hasElevatedRole([{ role_name: "Vice President" }])).toBe(false);
  });
});

// canReviewAllProjects is the mechanism behind
// supabase/migrations/0057_project_scoped_application_review.sql's
// can_review_all_projects(): VP Tech, President, and VP Projects keep full
// cross-project application-review visibility; everyone else (including a PM,
// and including a plain "exec" access_level with none of these three roles)
// is scoped to only the project(s) they PM. Keep this in sync with that
// migration's role-name list.
describe("FULL_ACCESS_REVIEW_ROLE_NAMES", () => {
  it("is exactly VP Tech, President, and VP Projects, matching migration 0057's can_review_all_projects()", () => {
    expect(FULL_ACCESS_REVIEW_ROLE_NAMES).toEqual(["VP Tech", "President", "VP Projects"]);
    expect(FULL_ACCESS_REVIEW_ROLE_NAMES).toContain(VP_TECH_ROLE_NAME);
    expect(FULL_ACCESS_REVIEW_ROLE_NAMES).toContain(PRESIDENT_ROLE_NAME);
    expect(FULL_ACCESS_REVIEW_ROLE_NAMES).toContain(VP_PROJECTS_ROLE_NAME);
  });
});

describe("canReviewAllProjects", () => {
  it("is true for VP Tech", () => {
    expect(canReviewAllProjects([{ role_name: "VP Tech" }])).toBe(true);
  });

  it("is true for President", () => {
    expect(canReviewAllProjects([{ role_name: "President" }])).toBe(true);
  });

  it("is true for VP Projects", () => {
    expect(canReviewAllProjects([{ role_name: "VP Projects" }])).toBe(true);
  });

  it("is true when the full-access role is one of several", () => {
    expect(
      canReviewAllProjects([{ role_name: "Member" }, { role_name: "PM" }, { role_name: "VP Projects" }]),
    ).toBe(true);
  });

  it("is false for a plain PM or generic exec/board role — those are project-scoped, not full-access", () => {
    expect(canReviewAllProjects([{ role_name: "PM" }])).toBe(false);
    expect(canReviewAllProjects([{ role_name: "Exec" }])).toBe(false);
    expect(canReviewAllProjects([{ role_name: "Board" }])).toBe(false);
  });

  it("is false for an empty role list", () => {
    expect(canReviewAllProjects([])).toBe(false);
  });

  it("is false when every role_name is null", () => {
    expect(canReviewAllProjects([{ role_name: null }, { role_name: null }])).toBe(false);
  });

  it("does not false-positive on a substring/case match", () => {
    expect(canReviewAllProjects([{ role_name: "vp projects" }])).toBe(false);
    expect(canReviewAllProjects([{ role_name: "VP of Projects" }])).toBe(false);
  });
});

describe("isPersona", () => {
  it("accepts the 3 valid personas", () => {
    expect(isPersona("member")).toBe(true);
    expect(isPersona("pm")).toBe(true);
    expect(isPersona("exec")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPersona("admin")).toBe(false);
    expect(isPersona(null)).toBe(false);
    expect(isPersona(undefined)).toBe(false);
    expect(isPersona("")).toBe(false);
  });
});

describe("accessIsBoardOrExec / accessIsExec", () => {
  it("board grants board-or-exec but not exec", () => {
    expect(accessIsBoardOrExec(["board"])).toBe(true);
    expect(accessIsExec(["board"])).toBe(false);
  });

  it("exec grants both", () => {
    expect(accessIsBoardOrExec(["exec"])).toBe(true);
    expect(accessIsExec(["exec"])).toBe(true);
  });

  it("neither for an empty/unrelated level list", () => {
    expect(accessIsBoardOrExec([])).toBe(false);
    expect(accessIsExec(["member"])).toBe(false);
  });
});

describe("personaFromAccessLevels", () => {
  it("exec takes priority over board", () => {
    expect(personaFromAccessLevels(["board", "exec"])).toBe("exec");
  });

  it("board alone maps to pm", () => {
    expect(personaFromAccessLevels(["board"])).toBe("pm");
  });

  it("no relevant levels maps to member", () => {
    expect(personaFromAccessLevels([])).toBe("member");
    expect(personaFromAccessLevels(["something-else"])).toBe("member");
  });
});
