// Unit tests for src/lib/csv.ts — the serializer behind the application
// sheet-view export. Applicant essays and answers are free text, so they
// routinely carry the three characters that break a naive CSV writer (comma,
// double quote, newline); these assert the RFC 4180 quoting rules that keep
// such a row from spilling into the next column or the next line.

import { describe, it, expect } from "vitest";
import { toCsv, csvSlug } from "@/lib/csv";

describe("toCsv", () => {
  it("writes a header row followed by one CRLF-separated row per record", () => {
    expect(toCsv(["Name", "Year"], [["Ada", "senior"], ["Grace", "junior"]])).toBe(
      "Name,Year\r\nAda,senior\r\nGrace,junior",
    );
  });

  it("emits just the header when there are no rows", () => {
    expect(toCsv(["Name"], [])).toBe("Name");
  });

  it("leaves plain values unquoted", () => {
    expect(toCsv(["a"], [["no punctuation here"]])).toBe("a\r\nno punctuation here");
  });

  it("quotes a value containing a comma so it stays one column", () => {
    expect(toCsv(["Classes"], [["CS 61A, CS 61B"]])).toBe('Classes\r\n"CS 61A, CS 61B"');
  });

  it("quotes and doubles embedded double quotes", () => {
    expect(toCsv(["Essay"], [['I said "hello"']])).toBe('Essay\r\n"I said ""hello"""');
  });

  it("quotes a value containing a newline so it stays one row", () => {
    expect(toCsv(["Essay"], [["line one\nline two"]])).toBe('Essay\r\n"line one\nline two"');
  });

  it("quotes a value containing a carriage return", () => {
    expect(toCsv(["Essay"], [["line one\r\nline two"]])).toBe('Essay\r\n"line one\r\nline two"');
  });

  it("keeps empty values as empty fields rather than dropping the column", () => {
    expect(toCsv(["a", "b", "c"], [["", "mid", ""]])).toBe("a,b,c\r\n,mid,");
  });

  it("quotes header text too, since question prompts become headers", () => {
    expect(toCsv(["Why this project, specifically?"], [["because"]])).toBe(
      '"Why this project, specifically?"\r\nbecause',
    );
  });
});

describe("csvSlug", () => {
  it("lowercases and hyphenates a period or project name", () => {
    expect(csvSlug("Fall 2026 Recruiting")).toBe("fall-2026-recruiting");
  });

  it("collapses runs of punctuation and trims leading/trailing hyphens", () => {
    expect(csvSlug("  OP Studio: Client Work!  ")).toBe("op-studio-client-work");
  });

  it("preserves existing hyphens and underscores", () => {
    expect(csvSlug("all-applicants_v2")).toBe("all-applicants_v2");
  });
});
