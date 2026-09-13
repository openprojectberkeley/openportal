// End-to-end test of the read side of the calendar sync: the Google Calendar
// API response → fetchCalendarEvents() → categorize(), with `fetch` stubbed.
//
// The fixture mirrors what events.list returns for the club's real calendar
// with singleEvents=true: the 10 GMs already expanded into discrete instances
// (which is the whole reason for that flag), the real all-day retreat, and the
// board meeting with its HTML description.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCalendarEvents, GoogleCalendarError } from "@/lib/google-calendar-feed";
import { ATTENDANCE_BY_DEFAULT, categorize, type EventCategory } from "@/lib/event-category";

const SERIES_A = "46b5c2ancfgeumbndmn6rvmth5"; // GM #2–#5
const SERIES_B = "34345lr1jhdns0gd7bjl8mrt9j"; // GM #6–#10

function timed(id: string, summary: string, startUtc: string, endUtc: string, extra = {}) {
  return {
    id, etag: `"${id}-1"`, status: "confirmed", summary,
    htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
    start: { dateTime: startUtc, timeZone: "America/Los_Angeles" },
    end: { dateTime: endUtc, timeZone: "America/Los_Angeles" },
    ...extra,
  };
}

// Weekly Thursday GMs, 8–9pm Pacific, as Google hands them back expanded.
const GM_DATES = [
  ["2026-09-11", "OP - GM #1"], ["2026-09-18", "OP - GM #2"], ["2026-09-25", "OP - GM #3"],
  ["2026-10-02", "OP - GM #4"], ["2026-10-09", "OP - GM #5"], ["2026-10-23", "OP - GM #6"],
  ["2026-10-30", "OP - GM #7"], ["2026-11-06", "OP - GM #8"], ["2026-11-13", "OP - GM #9"],
  ["2026-11-20", "OP - GM #10"],
] as const;

const ITEMS = [
  ...GM_DATES.map(([d, title], i) =>
    timed(`${i < 5 ? SERIES_A : SERIES_B}_${d.replace(/-/g, "")}T030000Z`, title,
      `${d}T03:00:00Z`, `${d}T04:00:00Z`, { location: "VLSB 2060" }),
  ),
  timed("infosession1", "Infosession 1", "2026-09-01T03:00:00Z", "2026-09-01T04:30:00Z", { location: "GPBB 100" }),
  timed("infosession2", "Infosession 2", "2026-09-05T03:00:00Z", "2026-09-05T04:30:00Z", { location: "VLSB 2040" }),
  timed("welcomenight", "Welcome Night", "2026-09-12T01:45:00Z", "2026-09-12T05:00:00Z", { location: "Dwinelle Plaza" }),
  timed("midsem", "OP - Mid Sem Presentation", "2026-10-16T03:00:00Z", "2026-10-16T05:00:00Z", { location: "GPBB 100" }),
  timed("finals", "OP - Final Semester Presentations", "2026-12-04T04:00:00Z", "2026-12-04T06:00:00Z", { location: "DWIN 155" }),
  timed("photoshoot", "OP FA26 Board Photoshoot", "2026-08-29T17:00:00Z", "2026-08-29T19:00:00Z"),
  timed("databytes", "Databytes", "2026-08-29T02:30:00Z", "2026-08-29T05:00:00Z"),
  timed("boardmtg", "[OP] First Board Meeting!", "2026-08-20T23:30:00Z", "2026-08-21T01:00:00Z", {
    description:
      'Topic: [OP Fa26] First Board Meeting<br>Join Zoom Meeting<br>' +
      '<a href="https://berkeley.zoom.us/j/5135329890">https://berkeley.zoom.us/j/5135329890</a>',
  }),
  // The retreat is the multi-day, all-day case. Google's all-day `end.date` is
  // EXCLUSIVE: Sep 26–27 comes back as end 2026-09-28.
  {
    id: "retreat", etag: '"retreat-1"', status: "confirmed", summary: "OP Retreat",
    start: { date: "2026-09-26" }, end: { date: "2026-09-28" },
  },
];

function stubFetch(pages: { items: unknown[]; nextPageToken?: string }[]) {
  const calls: string[] = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    calls.push(url.toString());
    const page = pages[i++];
    return { ok: true, json: async () => page } as unknown as Response;
  }));
  return calls;
}

const OPTS = { timeMin: new Date("2026-08-01"), timeMax: new Date("2027-01-01"), apiKey: "test-key" };

afterEach(() => vi.unstubAllGlobals());

describe("fetchCalendarEvents", () => {
  it("asks Google to expand recurrence and include deletions", async () => {
    const calls = stubFetch([{ items: [] }]);
    await fetchCalendarEvents("cal@group.calendar.google.com", OPTS);

    const url = new URL(calls[0]);
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("showDeleted")).toBe("true");
    expect(url.searchParams.get("orderBy")).toBe("startTime");
    expect(url.searchParams.get("key")).toBe("test-key");
    // The calendar id contains an @ and must survive path encoding.
    expect(url.pathname).toContain(encodeURIComponent("cal@group.calendar.google.com"));
  });

  it("follows pagination", async () => {
    stubFetch([
      { items: [ITEMS[0]], nextPageToken: "p2" },
      { items: [ITEMS[1]] },
    ]);
    const events = await fetchCalendarEvents("cal", OPTS);
    expect(events.map((e) => e.title)).toEqual(["OP - GM #1", "OP - GM #2"]);
  });

  it("categorizes the whole real calendar correctly", async () => {
    stubFetch([{ items: ITEMS }]);
    const events = await fetchCalendarEvents("cal", OPTS);
    expect(events).toHaveLength(19);

    const counts: Record<string, number> = {};
    for (const ev of events) {
      const c = categorize(ev.title, ev.description);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    expect(counts).toEqual({ gm: 10, recruitment: 3, milestone: 2, social: 2, board: 1, general: 1 });
  });

  it("enables attendance for exactly the 13 GM/milestone/board events", async () => {
    stubFetch([{ items: ITEMS }]);
    const events = await fetchCalendarEvents("cal", OPTS);
    const withAttendance = events.filter(
      (ev) => ATTENDANCE_BY_DEFAULT[categorize(ev.title, ev.description) as EventCategory],
    );
    expect(withAttendance).toHaveLength(13);
    expect(withAttendance.some((e) => e.title === "OP Retreat")).toBe(false);
  });

  it("pulls the exclusive all-day end back so the retreat spans Sep 26-27, not 28", async () => {
    stubFetch([{ items: [ITEMS.at(-1)] }]);
    const [retreat] = await fetchCalendarEvents("cal", OPTS);
    expect(retreat.all_day).toBe(true);
    expect(new Date(retreat.start_time).getDate()).toBe(26);
    expect(new Date(retreat.end_time!).getDate()).toBe(27);
  });

  it("strips HTML out of descriptions but keeps the Zoom link", async () => {
    stubFetch([{ items: [ITEMS.find((i) => i.id === "boardmtg")] }]);
    const [board] = await fetchCalendarEvents("cal", OPTS);
    expect(board.description).not.toMatch(/<[^>]+>/);
    expect(board.description).toContain("https://berkeley.zoom.us/j/5135329890");
    expect(categorize(board.title, board.description)).toBe("board");
  });

  it("surfaces cancelled instances so the sync can soft-cancel them", async () => {
    stubFetch([{ items: [{ ...ITEMS[3], status: "cancelled" }] }]);
    const [ev] = await fetchCalendarEvents("cal", OPTS);
    expect(ev.cancelled).toBe(true);
  });

  it("keeps per-instance ids distinct so attendance rows stay stable", async () => {
    stubFetch([{ items: ITEMS }]);
    const events = await fetchCalendarEvents("cal", OPTS);
    const ids = events.map((e) => e.external_id);
    expect(new Set(ids).size).toBe(ids.length);
    // The five GMs from one Google series must not collapse onto one id.
    expect(ids.filter((id) => id.startsWith(SERIES_A))).toHaveLength(5);
  });

  it("explains a 404 as a sharing problem rather than a bad key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 404, text: async () => "Not Found",
    } as unknown as Response)));
    await expect(fetchCalendarEvents("cal", OPTS)).rejects.toBeInstanceOf(GoogleCalendarError);
    await expect(fetchCalendarEvents("cal", OPTS)).rejects.toThrow(/shared as 'Make available to public'/);
  });
});
