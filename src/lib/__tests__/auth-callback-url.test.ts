// Unit tests for src/lib/auth-callback-url.ts. Tests run in Node (no DOM), so
// `window` is undefined unless a test stubs it in — that's what exercises the
// client-side branch of each function.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAuthCallbackUrl,
  getPasswordResetRedirectUrl,
} from "@/lib/auth-callback-url";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAuthCallbackUrl", () => {
  it("returns a relative path when window is undefined (server-side)", () => {
    expect(getAuthCallbackUrl()).toBe("/auth/callback");
  });

  it("returns an absolute URL under the current origin when window is defined", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://portal.example.com" },
    });

    expect(getAuthCallbackUrl()).toBe(
      "https://portal.example.com/auth/callback",
    );
  });
});

describe("getPasswordResetRedirectUrl", () => {
  it("returns a relative path when window is undefined (server-side)", () => {
    expect(getPasswordResetRedirectUrl()).toBe("/auth/update-password");
  });

  it("returns an absolute URL under the current origin when window is defined", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://portal.example.com" },
    });

    expect(getPasswordResetRedirectUrl()).toBe(
      "https://portal.example.com/auth/update-password",
    );
  });
});
