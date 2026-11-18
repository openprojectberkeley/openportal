import { describe, expect, it } from "vitest";
import { looksLikePdf, parseReviewRequest } from "@/lib/resume-review-request";

describe("parseReviewRequest", () => {
  it("accepts both fields being empty", () => {
    expect(parseReviewRequest({})).toEqual({ targetRoles: null, neededBy: null });
    expect(parseReviewRequest({ targetRoles: "  ", neededBy: "" })).toEqual({ targetRoles: null, neededBy: null });
  });

  it("keeps trimmed text and a real date", () => {
    expect(parseReviewRequest({ targetRoles: " SWE ", neededBy: "2026-12-01" })).toEqual({
      targetRoles: "SWE",
      neededBy: "2026-12-01",
    });
  });

  it("rejects bad input", () => {
    expect(parseReviewRequest(null)).toBeNull();
    expect(parseReviewRequest({ targetRoles: 4 })).toBeNull();
    expect(parseReviewRequest({ targetRoles: "x".repeat(1001) })).toBeNull();
    expect(parseReviewRequest({ neededBy: "2026-02-31" })).toBeNull();
    expect(parseReviewRequest({ neededBy: "soon" })).toBeNull();
  });
});

describe("looksLikePdf", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("finds the marker at or near the start", () => {
    expect(looksLikePdf(bytes("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(bytes("\n\n%PDF-1.4"))).toBe(true);
  });

  it("rejects other files", () => {
    expect(looksLikePdf(bytes("PK\u0003\u0004 word document"))).toBe(false);
    expect(looksLikePdf(bytes(`${" ".repeat(1024)}%PDF-1.7`))).toBe(false);
  });
});
