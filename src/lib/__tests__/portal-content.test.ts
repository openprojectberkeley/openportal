// Unit tests for src/lib/portal-content.ts — the normalization rules behind a
// portal's markdown page (supabase/migrations/0089_portal_content.sql). The
// column is nullable so that "never written" and "cleared" are one state, and
// the discard prompt keys off the same normalized comparison, so these two
// helpers decide both what lands in Postgres and when the user gets warned.

import { describe, it, expect } from "vitest";
import {
  MAX_PORTAL_CONTENT,
  hasUnsavedContent,
  normalizePortalContent,
} from "@/lib/portal-content";

describe("MAX_PORTAL_CONTENT", () => {
  it("matches the portals_content_length_check constraint in 0089", () => {
    expect(MAX_PORTAL_CONTENT).toBe(100000);
  });
});

describe("normalizePortalContent", () => {
  it("collapses an empty or whitespace-only draft to null, so clearing the page writes null rather than ''", () => {
    expect(normalizePortalContent("")).toBeNull();
    expect(normalizePortalContent("   ")).toBeNull();
    expect(normalizePortalContent("\n\n\t  \n")).toBeNull();
  });

  it("trims the outer edges", () => {
    expect(normalizePortalContent("  # Title  ")).toBe("# Title");
    expect(normalizePortalContent("\n\n# Title\n\n")).toBe("# Title");
  });

  it("preserves interior structure, since blank lines are load-bearing in markdown", () => {
    const doc = "# Title\n\n- one\n- two\n\n    indented code\n";
    expect(normalizePortalContent(doc)).toBe("# Title\n\n- one\n- two\n\n    indented code");
  });
});

describe("hasUnsavedContent", () => {
  it("is false when the draft matches the saved value", () => {
    expect(hasUnsavedContent("# Title", "# Title")).toBe(false);
  });

  it("is false for whitespace-only churn around an unchanged body", () => {
    expect(hasUnsavedContent("  # Title\n", "# Title")).toBe(false);
  });

  it("is false for an empty draft against never-written content", () => {
    expect(hasUnsavedContent("", null)).toBe(false);
    expect(hasUnsavedContent("   \n ", null)).toBe(false);
  });

  it("is true for a real edit", () => {
    expect(hasUnsavedContent("# Title", "# Other")).toBe(true);
  });

  it("is true when the user is adding the first content", () => {
    expect(hasUnsavedContent("# Title", null)).toBe(true);
  });

  it("is true when the user has cleared existing content", () => {
    expect(hasUnsavedContent("", "# Title")).toBe(true);
  });
});
