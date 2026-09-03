// Integration tests for the book_coffee_chat RPC + RLS
// (supabase/migrations/0035_coffee_chat_booking_rpc.sql).
//
// These hit a real Postgres/Supabase, so they're gated behind RUN_DB_TESTS to
// keep the default `npm test` pure. Run against a LOCAL stack — they create and
// delete users and mutate app_settings/coffee_chats:
//
//   supabase start
//   RUN_DB_TESTS=1 \
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_ANON_KEY=<anon key from `supabase status`> \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   npx vitest run src/lib/__tests__/booking.db.test.ts
//
// The migrations (0035 + 0038, which adds the optional booker message, + 0055,
// which adds coffee_chats.location_is_custom) must already be applied.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = process.env.RUN_DB_TESTS === "1";
const URL = process.env.SUPABASE_URL ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// A future time that clears the 6h notice and sits inside the window we set.
const HOST_TIME = new Date(Date.now() + 48 * 60 * 60 * 1000);
const HOST_TIME_2 = new Date(Date.now() + 49 * 60 * 60 * 1000);
const iso = (d: Date) => d.toISOString();
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const admin: SupabaseClient = RUN ? createClient(URL, SERVICE, { auth: { persistSession: false } }) : (null as never);

type TestUser = { id: string; email: string; client: SupabaseClient };

async function makeUser(tag: string): Promise<TestUser> {
  const email = `cc-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "test-password-123!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  return { id: data.user.id, email, client };
}

// Seed `count` open seats at `time` for host, returns the inserted row ids.
async function seedSeats(hostId: string, time: Date, count: number, duration = 30): Promise<string[]> {
  const rows = Array.from({ length: count }, () => ({
    member_id: hostId,
    meeting_time: iso(time),
    applicant_id: null,
    complete: false,
    duration_minutes: duration,
  }));
  const { data, error } = await admin.from("coffee_chats").insert(rows).select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

let host: TestUser;
let alice: TestUser;
let bob: TestUser;
const createdUserIds: string[] = [];

describe.skipIf(!RUN)("book_coffee_chat RPC", () => {
  beforeAll(async () => {
    // Window wide enough to contain HOST_TIME.
    await admin.from("app_settings").upsert({
      id: 1,
      coffee_chat_start: dateOnly(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      coffee_chat_end: dateOnly(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    });
    host = await makeUser("host");
    alice = await makeUser("alice");
    bob = await makeUser("bob");
    createdUserIds.push(host.id, alice.id, bob.id);
  });

  afterAll(async () => {
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
    for (const uid of createdUserIds) await admin.auth.admin.deleteUser(uid).catch(() => {});
  });

  it("claims one open seat on the happy path", async () => {
    await seedSeats(host.id, HOST_TIME, 1);
    const { data, error } = await alice.client.rpc("book_coffee_chat", {
      p_member_id: host.id,
      p_meeting_time: iso(HOST_TIME),
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    // Cleanup for later cases.
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("lets only one of two concurrent claims win the same single seat", async () => {
    await seedSeats(host.id, HOST_TIME, 1);
    const [r1, r2] = await Promise.all([
      alice.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME) }),
      bob.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME) }),
    ]);
    const wins = [r1, r2].filter((r) => !r.error).length;
    const losses = [r1, r2].filter((r) => r.error?.message.includes("slot_taken")).length;
    expect(wins).toBe(1);
    expect(losses).toBe(1);
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("lets only one of two concurrent same-user bookings across two times succeed", async () => {
    await seedSeats(host.id, HOST_TIME, 1);
    await seedSeats(host.id, HOST_TIME_2, 1);
    const [r1, r2] = await Promise.all([
      alice.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME) }),
      alice.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME_2) }),
    ]);
    const wins = [r1, r2].filter((r) => !r.error).length;
    const dupes = [r1, r2].filter((r) => r.error?.message.includes("already_booked")).length;
    expect(wins).toBe(1);
    expect(dupes).toBe(1);
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("rejects a slot inside the 6-hour minimum notice", async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await seedSeats(host.id, soon, 1);
    const { error } = await alice.client.rpc("book_coffee_chat", {
      p_member_id: host.id,
      p_meeting_time: iso(soon),
    });
    expect(error?.message).toContain("too_soon");
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("rejects a slot outside the booking window", async () => {
    const far = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await seedSeats(host.id, far, 1);
    const { error } = await alice.client.rpc("book_coffee_chat", {
      p_member_id: host.id,
      p_meeting_time: iso(far),
    });
    expect(error?.message).toContain("past_or_out_of_window");
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("rejects booking your own slot", async () => {
    await seedSeats(host.id, HOST_TIME, 1);
    const { error } = await host.client.rpc("book_coffee_chat", {
      p_member_id: host.id,
      p_meeting_time: iso(HOST_TIME),
    });
    expect(error?.message).toContain("self_book");
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("rejects a second upcoming chat with the same host", async () => {
    await seedSeats(host.id, HOST_TIME, 1);
    await seedSeats(host.id, HOST_TIME_2, 1);
    const first = await alice.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME) });
    expect(first.error).toBeNull();
    const second = await alice.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME_2) });
    expect(second.error?.message).toContain("already_booked");
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("fills every seat of a multi-seat slot but no more", async () => {
    await seedSeats(host.id, HOST_TIME, 2);
    const a = await alice.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME) });
    const b = await bob.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME) });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    // A third user finds no open seat.
    const carol = await makeUser("carol");
    createdUserIds.push(carol.id);
    const c = await carol.client.rpc("book_coffee_chat", { p_member_id: host.id, p_meeting_time: iso(HOST_TIME) });
    expect(c.error?.message).toContain("slot_taken");
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("stores an optional booker message on the claimed row, trimmed", async () => {
    const [rowId] = await seedSeats(host.id, HOST_TIME, 1);
    const { data, error } = await alice.client.rpc("book_coffee_chat", {
      p_member_id: host.id,
      p_meeting_time: iso(HOST_TIME),
      p_message: "  Excited to talk about the infra track!  ",
    });
    expect(error).toBeNull();
    expect(data).toBe(rowId);
    const { data: row } = await admin.from("coffee_chats").select("message").eq("id", rowId).single();
    expect(row?.message).toBe("Excited to talk about the infra track!");
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("leaves message null when omitted or blank", async () => {
    const [rowId] = await seedSeats(host.id, HOST_TIME, 1);
    // Omitted entirely (2-arg call still valid via the parameter default).
    const { error } = await alice.client.rpc("book_coffee_chat", {
      p_member_id: host.id,
      p_meeting_time: iso(HOST_TIME),
    });
    expect(error).toBeNull();
    const { data: row } = await admin.from("coffee_chats").select("message").eq("id", rowId).single();
    expect(row?.message).toBeNull();
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });

  it("rejects a direct client UPDATE claim (RLS closes the old hole)", async () => {
    const [rowId] = await seedSeats(host.id, HOST_TIME, 1);
    // The dropped "Applicant can claim an open spot" policy means a plain
    // update can no longer set applicant_id — RLS filters it to zero rows.
    const { data } = await alice.client
      .from("coffee_chats")
      .update({ applicant_id: alice.id })
      .eq("id", rowId)
      .is("applicant_id", null)
      .select();
    expect(data ?? []).toHaveLength(0);
    // And the seat is still open.
    const { data: check } = await admin.from("coffee_chats").select("applicant_id").eq("id", rowId).single();
    expect(check?.applicant_id).toBeNull();
    await admin.from("coffee_chats").delete().eq("member_id", host.id);
  });
});

// Integration tests for set_default_chat_location
// (supabase/migrations/0055_coffee_chat_location_is_custom.sql). Same gating and
// setup as above.
describe.skipIf(!RUN)("set_default_chat_location RPC", () => {
  let h: TestUser;
  let u1: TestUser; // chat with no location (inherited)
  let u2: TestUser; // chat still on the old default (inherited)
  let u3: TestUser; // chat with a manual custom location
  let u4: TestUser; // chat whose value drifted from the default but is inherited
  const uids: string[] = [];
  const T1 = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const T2 = new Date(Date.now() + 49 * 60 * 60 * 1000);
  const T3 = new Date(Date.now() + 50 * 60 * 60 * 1000);
  const T4 = new Date(Date.now() + 51 * 60 * 60 * 1000);
  const OLD = "https://old.example.com/room";
  const NEW = "https://new.example.com/room";
  const CUSTOM = "In person — Moffitt 4th floor";
  const DRIFT = "https://stale.example.com/room";

  // Book one seat at `time` for host as `who`, returning the booked row id.
  async function book(who: TestUser, time: Date): Promise<string> {
    await seedSeats(h.id, time, 1);
    const { data, error } = await who.client.rpc("book_coffee_chat", {
      p_member_id: h.id,
      p_meeting_time: iso(time),
    });
    if (error) throw error;
    return data as string;
  }

  const locOf = async (id: string) => {
    const { data } = await admin.from("coffee_chats").select("location").eq("id", id).single();
    return data?.location as string | null;
  };

  const customOf = async (id: string) => {
    const { data } = await admin.from("coffee_chats").select("location_is_custom").eq("id", id).single();
    return data?.location_is_custom as boolean;
  };

  beforeAll(async () => {
    await admin.from("app_settings").upsert({
      id: 1,
      coffee_chat_start: dateOnly(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      coffee_chat_end: dateOnly(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    });
    h = await makeUser("dl-host");
    u1 = await makeUser("dl-u1");
    u2 = await makeUser("dl-u2");
    u3 = await makeUser("dl-u3");
    u4 = await makeUser("dl-u4");
    uids.push(h.id, u1.id, u2.id, u3.id, u4.id);
    // The RPC updates members where user_id = auth.uid(); the host needs a row.
    await admin.from("members").upsert({ user_id: h.id }, { onConflict: "user_id" });
  });

  afterAll(async () => {
    await admin.from("notifications").delete().eq("member_id", h.id);
    await admin.from("coffee_chats").delete().eq("member_id", h.id);
    for (const uid of uids) await admin.auth.admin.deleteUser(uid).catch(() => {});
  });

  it("book_coffee_chat leaves an inherited seat non-custom and preserves a pre-set custom seat", async () => {
    await admin.from("members").update({ default_chat_location: OLD }).eq("user_id", h.id);

    // Fresh open seat: booking freezes the default and leaves it non-custom.
    const c1 = await book(u1, T1);
    expect(await locOf(c1)).toBe(OLD);
    expect(await customOf(c1)).toBe(false);

    // A seat with a manual per-slot location keeps it and stays custom on booking.
    const [openId] = await seedSeats(h.id, T2, 1);
    await admin.from("coffee_chats").update({ location: CUSTOM, location_is_custom: true }).eq("id", openId);
    const { data: c2, error } = await u2.client.rpc("book_coffee_chat", { p_member_id: h.id, p_meeting_time: iso(T2) });
    expect(error).toBeNull();
    expect(await locOf(c2 as string)).toBe(CUSTOM);
    expect(await customOf(c2 as string)).toBe(true);

    await admin.from("notifications").delete().eq("member_id", h.id);
    await admin.from("coffee_chats").delete().eq("member_id", h.id);
  });

  it("propagates to every non-custom chat regardless of value, preserves custom, and notifies", async () => {
    const c1 = await book(u1, T1);
    const c2 = await book(u2, T2);
    const c3 = await book(u3, T3);
    const c4 = await book(u4, T4);
    // Force each row into its starting state and set the host's current default.
    // c4's value has drifted from the default yet is still inherited — the case
    // the old value heuristic stranded; it must still be rewritten.
    await admin.from("coffee_chats").update({ location: null, location_is_custom: false }).eq("id", c1);
    await admin.from("coffee_chats").update({ location: OLD, location_is_custom: false }).eq("id", c2);
    await admin.from("coffee_chats").update({ location: CUSTOM, location_is_custom: true }).eq("id", c3);
    await admin.from("coffee_chats").update({ location: DRIFT, location_is_custom: false }).eq("id", c4);
    await admin.from("members").update({ default_chat_location: OLD }).eq("user_id", h.id);

    const { data: count, error } = await h.client.rpc("set_default_chat_location", { p_location: NEW });
    expect(error).toBeNull();
    expect(count).toBe(3); // c1 (added) + c2 + c4 (updated); c3 preserved

    expect(await locOf(c1)).toBe(NEW);
    expect(await locOf(c2)).toBe(NEW);
    expect(await locOf(c3)).toBe(CUSTOM);
    expect(await locOf(c4)).toBe(NEW);

    const { data: me } = await admin.from("members").select("default_chat_location").eq("user_id", h.id).single();
    expect(me?.default_chat_location).toBe(NEW);

    // Attendees of changed chats are notified; the custom-chat attendee is not.
    const notifOf = async (uid: string, chatId: string) => {
      const { data } = await admin
        .from("notifications")
        .select("type")
        .eq("user_id", uid)
        .eq("coffee_chat_id", chatId);
      return (data ?? []).map((n) => n.type as string);
    };
    expect(await notifOf(u1.id, c1)).toContain("location_added");
    expect(await notifOf(u2.id, c2)).toContain("location_updated");
    expect(await notifOf(u4.id, c4)).toContain("location_updated");
    expect(await notifOf(u3.id, c3)).toHaveLength(0);

    await admin.from("notifications").delete().eq("member_id", h.id);
    await admin.from("coffee_chats").delete().eq("member_id", h.id);
  });

  it("clearing the default resets non-custom rows to null without notifying", async () => {
    const c1 = await book(u1, T1);
    const c3 = await book(u3, T3);
    await admin.from("coffee_chats").update({ location: OLD, location_is_custom: false }).eq("id", c1);
    await admin.from("coffee_chats").update({ location: CUSTOM, location_is_custom: true }).eq("id", c3);
    await admin.from("members").update({ default_chat_location: OLD }).eq("user_id", h.id);

    const { data: count, error } = await h.client.rpc("set_default_chat_location", { p_location: "" });
    expect(error).toBeNull();
    expect(count).toBe(1); // only c1 reset; c3 custom preserved

    expect(await locOf(c1)).toBeNull();
    expect(await locOf(c3)).toBe(CUSTOM);

    const { data: me } = await admin.from("members").select("default_chat_location").eq("user_id", h.id).single();
    expect(me?.default_chat_location).toBeNull();

    // No notification for a silent reset.
    const { data: notifs } = await admin.from("notifications").select("id").eq("member_id", h.id);
    expect(notifs ?? []).toHaveLength(0);

    await admin.from("coffee_chats").delete().eq("member_id", h.id);
  });
});
