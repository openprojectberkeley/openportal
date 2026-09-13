// Unit tests for src/lib/calendar-subscribe.ts.

import { describe, expect, it } from "vitest";
import {
  googleSubscribeUrl,
  icsHttpsUrl,
  icsSubscribeUrl,
} from "@/lib/calendar-subscribe";

// The club's real calendar id — the "@" is the part that has to survive encoding.
const CAL = "b05f5d09d2f1523ca1bd3c30eba429c49d1df6da84dbff2463a9e8a228436778@group.calendar.google.com";

describe("googleSubscribeUrl", () => {
  it("points at Google's add-calendar prompt with the id in cid", () => {
    const url = new URL(googleSubscribeUrl(CAL));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    // URL parsing decodes it back, which is the round-trip that matters.
    expect(url.searchParams.get("cid")).toBe(CAL);
  });

  it("percent-encodes the @ rather than leaving it raw in the query", () => {
    expect(googleSubscribeUrl(CAL)).toContain("%40group.calendar.google.com");
    expect(googleSubscribeUrl(CAL)).not.toContain("@group.calendar.google.com");
  });
});

describe("icsSubscribeUrl", () => {
  // The whole point of this function: a clicked https .ics is a one-time
  // import, while webcal:// subscribes. Regressing the scheme would silently
  // give everyone a calendar that never updates.
  it("uses the webcal scheme so calendar apps subscribe instead of importing", () => {
    expect(icsSubscribeUrl(CAL).startsWith("webcal://")).toBe(true);
    expect(icsSubscribeUrl(CAL).startsWith("https://")).toBe(false);
  });

  it("hits the public basic.ics feed with the id encoded in the path", () => {
    expect(icsSubscribeUrl(CAL)).toBe(
      `webcal://calendar.google.com/calendar/ical/${encodeURIComponent(CAL)}/public/basic.ics`,
    );
    expect(icsSubscribeUrl(CAL)).toContain("%40group.calendar.google.com");
  });
});

describe("icsHttpsUrl", () => {
  it("is the same path over https", () => {
    expect(icsHttpsUrl(CAL)).toBe(icsSubscribeUrl(CAL).replace("webcal://", "https://"));
  });

  it("parses as a real URL", () => {
    const url = new URL(icsHttpsUrl(CAL));
    expect(url.host).toBe("calendar.google.com");
    expect(url.pathname.endsWith("/public/basic.ics")).toBe(true);
    // decodeURIComponent of the id segment gets the original id back.
    expect(decodeURIComponent(url.pathname.split("/")[3])).toBe(CAL);
  });
});
