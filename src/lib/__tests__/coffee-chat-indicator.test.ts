import { describe, expect, it } from "vitest";
import { coffeeChatLabel, coffeeWithByApplicant } from "@/lib/coffee-chat-indicator";

describe("coffeeChatLabel", () => {
  it("falls back to generic copy without names", () => {
    expect(coffeeChatLabel("done")).toBe("Completed a coffee chat");
    expect(coffeeChatLabel("booked")).toBe("Coffee chat booked");
  });

  it("includes partner names when provided", () => {
    expect(coffeeChatLabel("done", ["Alice Chen", "Bob Lee"])).toBe(
      "Coffee chatted with Alice Chen, Bob Lee",
    );
    expect(coffeeChatLabel("booked", ["Alice Chen"])).toBe("Coffee chat booked with Alice Chen");
  });
});

describe("coffeeWithByApplicant", () => {
  const hosts = { h1: "Alice Chen", h2: "Bob Lee", h3: "Carol Park" };

  it("uses completed hosts when any chat is done", () => {
    expect(
      coffeeWithByApplicant(
        [
          { applicant_id: "a1", member_id: "h1", complete: true },
          { applicant_id: "a1", member_id: "h2", complete: false },
        ],
        hosts,
      ),
    ).toEqual({ a1: ["Alice Chen"] });
  });

  it("uses booked hosts when nothing is complete", () => {
    expect(
      coffeeWithByApplicant([{ applicant_id: "a1", member_id: "h2", complete: false }], hosts),
    ).toEqual({ a1: ["Bob Lee"] });
  });

  it("dedupes repeat chats with the same host", () => {
    expect(
      coffeeWithByApplicant(
        [
          { applicant_id: "a1", member_id: "h1", complete: true },
          { applicant_id: "a1", member_id: "h1", complete: true },
          { applicant_id: "a1", member_id: "h3", complete: true },
        ],
        hosts,
      ),
    ).toEqual({ a1: ["Alice Chen", "Carol Park"] });
  });
});
