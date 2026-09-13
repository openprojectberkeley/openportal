// Unit tests for the pure helpers in src/lib/google-calendar-feed.ts.
// Network fetching is exercised by the sync route's integration run, not here.

import { describe, expect, it } from "vitest";
import { htmlToText } from "@/lib/google-calendar-feed";

describe("htmlToText", () => {
  // Verbatim from the club calendar's "[OP] First Board Meeting!" description,
  // which is the only event carrying markup today.
  const REAL = [
    "Topic: [OP Fa26] First Board Meeting<br>",
    "Time: Aug 20, 2026 04:30 PM Pacific Time (US and Canada)<br>",
    "Join Zoom Meeting<br>",
    '<a href="https://berkeley.zoom.us/j/5135329890?omn=97210468785">',
    "https://berkeley.zoom.us/j/5135329890?omn=97210468785</a>",
  ].join("");

  it("flattens the real board-meeting description without losing the Zoom link", () => {
    const text = htmlToText(REAL);
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).toContain("Topic: [OP Fa26] First Board Meeting");
    expect(text).toContain("https://berkeley.zoom.us/j/5135329890?omn=97210468785");
    // The anchor text repeated the href — it should appear once, not twice.
    expect(text.match(/berkeley\.zoom\.us/g)).toHaveLength(1);
  });

  it("turns <br> into line breaks", () => {
    expect(htmlToText("a<br>b<br/>c<BR />d")).toBe("a\nb\nc\nd");
  });

  it("keeps the destination when link text differs from the href", () => {
    expect(htmlToText('<a href="https://x.test/rsvp">RSVP here</a>')).toBe(
      "RSVP here (https://x.test/rsvp)",
    );
  });

  it("decodes entities", () => {
    expect(htmlToText("Tech &amp; Design &#39;26 &lt;tag&gt;")).toBe("Tech & Design '26 <tag>");
    expect(htmlToText("a&nbsp;b")).toBe("a b");
  });

  it("collapses runaway blank lines and trims", () => {
    expect(htmlToText("<p>one</p><p></p><p></p><p>two</p>  ")).toBe("one\n\ntwo");
  });

  it("passes plain text through untouched", () => {
    expect(htmlToText("Professional Development - Resume Workshop!")).toBe(
      "Professional Development - Resume Workshop!",
    );
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(htmlToText("100&thinsp;%")).toBe("100&thinsp;%");
  });
});
