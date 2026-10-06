// Integration tests for families and the per-semester points competition
// (supabase/migrations/0103_families_and_scoring.sql): the RLS on `families`,
// `semesters` and `score_entries`, the exec-only guard on `projects.family_id`,
// the award/void/set-active RPCs, and the three read aggregates.
//
// These hit a real Postgres/Supabase, so they're gated behind RUN_DB_TESTS to
// keep the default `npm test` pure. Run against a LOCAL stack — they create and
// delete users, projects, families and semesters:
//
//   supabase start
//   RUN_DB_TESTS=1 \
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_ANON_KEY=<anon key from `supabase status`> \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   npx vitest run src/lib/__tests__/scoring.db.test.ts
//
// Migration 0100 must already be applied. The exec scenarios need a `roles` row
// whose access_level is 'exec' to exist in that environment (roles are
// dashboard-managed, not seeded by any migration) — if none is found, those
// assertions are skipped with a console.warn rather than failing the suite.
//
// The point of the deny tests is that RLS, not the UI, is the authorization
// boundary: every write in this feature goes straight from the browser client,
// and `score_entries` deliberately has no write policy at all. A PM is tested
// alongside a plain member because 0017 lets a PM update their own project row
// and `is_board_or_exec()` counts PMs as board — both are ways a PM could
// otherwise have scored their own project.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = process.env.RUN_DB_TESTS === "1";
const URL = process.env.SUPABASE_URL ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const admin: SupabaseClient = RUN
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : (null as never);

type TestUser = { id: string; email: string; client: SupabaseClient };

const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];
const createdFamilyIds: string[] = [];
const createdSemesterIds: string[] = [];

async function makeUser(tag: string): Promise<TestUser> {
  const email = `scoring-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "test-password-123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  createdUserIds.push(data.user.id);
  await admin.from("members").upsert({ user_id: data.user.id }, { onConflict: "user_id" });
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  return { id: data.user.id, email, client };
}

async function makeProject(name: string): Promise<string> {
  const { data, error } = await admin
    .from("projects")
    .insert({ name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}` })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("project insert failed");
  createdProjectIds.push(data.id);
  return data.id;
}

async function makeFamily(name: string): Promise<string> {
  const { data, error } = await admin
    .from("families")
    .insert({ name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}` })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("family insert failed");
  createdFamilyIds.push(data.id);
  return data.id;
}

async function makeSemester(name: string): Promise<string> {
  const { data, error } = await admin
    .from("semesters")
    .insert({ name: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}` })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("semester insert failed");
  createdSemesterIds.push(data.id);
  return data.id;
}

let exec: TestUser | null = null;
let pm: TestUser;
let plain: TestUser;

let familyX: string;
let familyY: string;
let projectA: string; // family X
let projectB: string; // family X, gets a deduction
let projectC: string; // family Y
let projectPm: string; // pm is the PM here, no family
let semester1: string;
let semester2: string;
let execRoleId: number | null = null;

// Points a service-role insert lands directly, bypassing the RPC gate, so the
// read aggregates can be tested without needing an exec session.
async function seed(
  semesterId: string,
  projectId: string,
  points: number,
  reason = "test",
): Promise<string> {
  const { data, error } = await admin
    .from("score_entries")
    .insert({ semester_id: semesterId, project_id: projectId, points, reason })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("score_entries insert failed");
  return data.id;
}

type Standing = {
  family_id: string;
  points: number;
  rank: number;
  award_count: number;
  project_count: number;
};

async function standings(semesterId: string): Promise<Map<string, Standing>> {
  const { data, error } = await admin.rpc("family_standings", { p_semester_id: semesterId });
  if (error) throw error;
  return new Map((data as Standing[]).map((r) => [r.family_id, r]));
}

describe.skipIf(!RUN)("families + scoring (0100)", () => {
  beforeAll(async () => {
    [pm, plain] = await Promise.all([makeUser("pm"), makeUser("plain")]);

    // Any role whose access_level is 'exec' satisfies is_exec().
    const { data: roleRow } = await admin
      .from("roles")
      .select("id")
      .eq("access_level", "exec")
      .limit(1)
      .maybeSingle();
    if (roleRow) {
      execRoleId = roleRow.id;
      exec = await makeUser("exec");
      await admin.from("members_roles").insert({ user_id: exec.id, role_id: execRoleId });
      // Re-sign-in isn't needed — is_exec() reads members_roles per call, not
      // a claim baked into the JWT.
    } else {
      console.warn("No role with access_level 'exec' in this environment; exec tests skipped.");
    }

    [familyX, familyY] = await Promise.all([makeFamily("x"), makeFamily("y")]);
    [projectA, projectB, projectC, projectPm] = await Promise.all([
      makeProject("a"),
      makeProject("b"),
      makeProject("c"),
      makeProject("pm"),
    ]);
    [semester1, semester2] = await Promise.all([makeSemester("s1"), makeSemester("s2")]);

    await admin.from("projects").update({ family_id: familyX }).in("id", [projectA, projectB]);
    await admin.from("projects").update({ family_id: familyY }).eq("id", projectC);
    await admin.from("project_members").insert({
      project_id: projectPm,
      user_id: pm.id,
      is_pm: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    // score_entries cascade from projects; semesters are ON DELETE RESTRICT, so
    // the entries have to go before the semesters do.
    if (createdProjectIds.length) {
      await admin.from("score_entries").delete().in("project_id", createdProjectIds);
      await admin.from("projects").delete().in("id", createdProjectIds);
    }
    if (createdSemesterIds.length) await admin.from("semesters").delete().in("id", createdSemesterIds);
    if (createdFamilyIds.length) await admin.from("families").delete().in("id", createdFamilyIds);
    if (execRoleId !== null && exec) {
      await admin.from("members_roles").delete().eq("user_id", exec.id).eq("role_id", execRoleId);
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  describe("a non-exec cannot write", () => {
    it("cannot insert into the ledger directly (no insert policy exists)", async () => {
      for (const user of [plain, pm]) {
        const { error } = await user.client
          .from("score_entries")
          .insert({ semester_id: semester1, project_id: projectA, points: 50, reason: "mine" });
        expect(error).not.toBeNull();
      }
    });

    it("cannot award through the RPC — not even a PM of the target project", async () => {
      for (const [user, project] of [
        [plain, projectA],
        [pm, projectPm],
      ] as const) {
        const { error } = await user.client.rpc("award_score", {
          p_project_id: project,
          p_points: 50,
          p_reason: "mine",
          p_awarded_on: null,
          p_semester_id: semester1,
        });
        expect(error?.message).toContain("not authorized");
      }
    });

    it("cannot void an entry", async () => {
      const entryId = await seed(semester1, projectA, 10, "to void by non-exec");
      const { error } = await plain.client.rpc("void_score_entry", { p_entry_id: entryId });
      expect(error?.message).toContain("not authorized");

      // Still live.
      const { data } = await admin
        .from("score_entries")
        .select("voided_at")
        .eq("id", entryId)
        .single();
      expect(data?.voided_at).toBeNull();
      await admin.from("score_entries").delete().eq("id", entryId);
    });

    it("cannot update or delete a ledger row (no such policies)", async () => {
      const entryId = await seed(semester1, projectA, 10, "immutable");
      // No UPDATE policy: the row is invisible to the write, so this affects
      // zero rows rather than raising.
      await plain.client
        .from("score_entries")
        .update({ points: 9999 })
        .eq("id", entryId);
      await plain.client.from("score_entries").delete().eq("id", entryId);

      const { data } = await admin
        .from("score_entries")
        .select("points")
        .eq("id", entryId)
        .maybeSingle();
      expect(data?.points).toBe(10);
      await admin.from("score_entries").delete().eq("id", entryId);
    });

    it("cannot switch the active semester", async () => {
      const { error } = await plain.client.rpc("set_active_semester", {
        p_semester_id: semester1,
      });
      expect(error?.message).toContain("not authorized");
    });

    it("cannot reassign a project's family — even its own PM", async () => {
      const { error } = await pm.client
        .from("projects")
        .update({ family_id: familyX })
        .eq("id", projectPm);
      expect(error?.message).toContain("Only exec can change");

      const { data } = await admin
        .from("projects")
        .select("family_id")
        .eq("id", projectPm)
        .single();
      expect(data?.family_id).toBeNull();
    });

    it("leaves 0017's PM edit rights intact", async () => {
      // The guard must reject only a family_id change, not every PM update.
      const { error } = await pm.client
        .from("projects")
        .update({ description: "edited by its PM" })
        .eq("id", projectPm);
      expect(error).toBeNull();
    });

    it("cannot write families or semesters", async () => {
      const f = await plain.client.from("families").insert({ name: "sneaky" });
      expect(f.error).not.toBeNull();
      const fu = await plain.client.from("families").update({ name: "renamed" }).eq("id", familyX);
      expect(fu.error).not.toBeNull();
      const s = await plain.client.from("semesters").insert({ name: "sneaky" });
      expect(s.error).not.toBeNull();
    });
  });

  describe("everyone signed in can read", () => {
    it("reads all three tables", async () => {
      const [f, s, e] = await Promise.all([
        plain.client.from("families").select("id").limit(1),
        plain.client.from("semesters").select("id").limit(1),
        plain.client.from("score_entries").select("id").limit(1),
      ]);
      expect(f.error).toBeNull();
      expect(s.error).toBeNull();
      expect(e.error).toBeNull();
    });

    it("calls all three read RPCs", async () => {
      const [a, b, c] = await Promise.all([
        plain.client.rpc("family_standings", { p_semester_id: semester1 }),
        plain.client.rpc("project_scores", { p_semester_id: semester1 }),
        plain.client.rpc("score_ledger", { p_semester_id: semester1, p_limit: 10 }),
      ]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      expect(c.error).toBeNull();
    });
  });

  describe("anon has no execute grant", () => {
    it("refuses an unauthenticated caller", async () => {
      // 0097's point: `revoke ... from public, anon` is what makes this true —
      // revoking from anon alone is a no-op, since anon inherits the default
      // PUBLIC grant. Checking the grant itself needs raw SQL the client can't
      // issue, so assert the property that matters at the edge.
      const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
      for (const fn of ["family_standings", "project_scores"]) {
        const { error } = await anonClient.rpc(fn, { p_semester_id: semester1 });
        expect(error).not.toBeNull();
      }
      const { error: awardError } = await anonClient.rpc("award_score", {
        p_project_id: projectA,
        p_points: 10,
        p_reason: "anon",
        p_awarded_on: null,
        p_semester_id: semester1,
      });
      expect(awardError).not.toBeNull();
    });
  });

  describe("the arithmetic", () => {
    it("sums a family from its projects, ranks by points, and scopes by semester", async () => {
      const ids = await Promise.all([
        seed(semester1, projectA, 50, "a1"),
        seed(semester1, projectA, 10, "a2"),
        seed(semester1, projectB, -5, "penalty"),
        seed(semester1, projectC, 100, "c1"),
        // A different semester must not leak into semester1's totals.
        seed(semester2, projectA, 1000, "other semester"),
      ]);

      let board = await standings(semester1);
      expect(board.get(familyX)?.points).toBe(55);
      expect(board.get(familyY)?.points).toBe(100);
      expect(board.get(familyY)?.rank).toBe(1);
      expect(board.get(familyX)?.rank).toBe(2);
      expect(board.get(familyX)?.award_count).toBe(3);

      const { data: perProject } = await admin.rpc("project_scores", {
        p_semester_id: semester1,
      });
      const byProject = new Map(
        (perProject as { project_id: string; points: number }[]).map((r) => [r.project_id, r.points]),
      );
      expect(byProject.get(projectA)).toBe(60);
      expect(byProject.get(projectB)).toBe(-5);
      expect(byProject.get(projectC)).toBe(100);

      // Voiding the +50 drops it out of every sum but keeps the row.
      // score_entries_void_pair requires voided_at and voided_by to be set or
      // unset together, so both go in one statement.
      const { error: voidSeedError } = await admin
        .from("score_entries")
        .update({ voided_at: new Date().toISOString(), voided_by: plain.id })
        .eq("id", ids[0]);
      expect(voidSeedError).toBeNull();

      board = await standings(semester1);
      expect(board.get(familyX)?.points).toBe(5);
      expect(board.get(familyX)?.award_count).toBe(2);

      const { data: ledger } = await admin.rpc("score_ledger", {
        p_semester_id: semester1,
        p_limit: 50,
      });
      const voided = (ledger as { id: string; voided_at: string | null }[]).find(
        (r) => r.id === ids[0],
      );
      expect(voided?.voided_at).not.toBeNull();

      // A family's total follows its projects' CURRENT assignment: moving
      // project A carries its history across. This is the accepted tradeoff of
      // not freezing family_id onto every ledger row.
      await admin.from("projects").update({ family_id: familyY }).eq("id", projectA);
      board = await standings(semester1);
      expect(board.get(familyX)?.points).toBe(-5);
      expect(board.get(familyY)?.points).toBe(110);
      await admin.from("projects").update({ family_id: familyX }).eq("id", projectA);

      await admin.from("score_entries").delete().in("id", ids);
    });

    it("keeps an empty family on the board at zero", async () => {
      const empty = await makeFamily("empty");
      const board = await standings(semester1);
      expect(board.get(empty)?.points).toBe(0);
      expect(board.get(empty)?.project_count ?? 0).toBe(0);
    });

    it("surfaces a project with points but no family", async () => {
      const id = await seed(semester1, projectPm, 7, "orphan points");
      const { data } = await admin.rpc("project_scores", { p_semester_id: semester1 });
      const row = (data as { project_id: string; family_id: string | null }[]).find(
        (r) => r.project_id === projectPm,
      );
      expect(row).toBeDefined();
      expect(row?.family_id).toBeNull();
      await admin.from("score_entries").delete().eq("id", id);
    });
  });

  describe("constraints", () => {
    it("rejects zero points, an empty reason, and an out-of-range amount", async () => {
      for (const row of [
        { semester_id: semester1, project_id: projectA, points: 0, reason: "zero" },
        { semester_id: semester1, project_id: projectA, points: 5, reason: "   " },
        { semester_id: semester1, project_id: projectA, points: 99999, reason: "huge" },
      ]) {
        const { error } = await admin.from("score_entries").insert(row);
        expect(error).not.toBeNull();
      }
    });

    it("allows at most one active semester", async () => {
      await admin.from("semesters").update({ is_active: true }).eq("id", semester1);
      const { error } = await admin.from("semesters").update({ is_active: true }).eq("id", semester2);
      expect(error?.code).toBe("23505");
      await admin.from("semesters").update({ is_active: false }).eq("id", semester1);
    });

    it("refuses to delete a semester that has points logged against it", async () => {
      const id = await seed(semester2, projectC, 5, "keeps the semester alive");
      const { error } = await admin.from("semesters").delete().eq("id", semester2);
      expect(error?.code).toBe("23503");
      await admin.from("score_entries").delete().eq("id", id);
    });

    it("unassigns rather than deletes a family's projects when the family goes", async () => {
      const doomed = await makeFamily("doomed");
      const orphan = await makeProject("orphan");
      await admin.from("projects").update({ family_id: doomed }).eq("id", orphan);
      const id = await seed(semester1, orphan, 15, "before deletion");

      const { error } = await admin.from("families").delete().eq("id", doomed);
      expect(error).toBeNull();

      const { data: proj } = await admin
        .from("projects")
        .select("family_id")
        .eq("id", orphan)
        .single();
      expect(proj?.family_id).toBeNull();

      // The award survives, now counting for nobody.
      const { data: entry } = await admin
        .from("score_entries")
        .select("points")
        .eq("id", id)
        .single();
      expect(entry?.points).toBe(15);
      await admin.from("score_entries").delete().eq("id", id);
    });
  });

  describe("exec can write", () => {
    it("awards, voids, and switches the active semester", async () => {
      if (!exec) {
        console.warn("no exec user in this environment; skipping");
        return;
      }

      const { data: newId, error: awardError } = await exec.client.rpc("award_score", {
        p_project_id: projectA,
        p_points: 42,
        p_reason: "awarded by exec",
        p_awarded_on: null,
        p_semester_id: semester1,
      });
      expect(awardError).toBeNull();
      expect(newId).toBeTruthy();

      // awarded_by is stamped from auth.uid(), not from the client.
      const { data: row } = await admin
        .from("score_entries")
        .select("awarded_by, points")
        .eq("id", newId)
        .single();
      expect(row?.awarded_by).toBe(exec.id);
      expect(row?.points).toBe(42);

      const { error: voidError } = await exec.client.rpc("void_score_entry", {
        p_entry_id: newId,
      });
      expect(voidError).toBeNull();

      const { data: voided } = await admin
        .from("score_entries")
        .select("voided_at, voided_by")
        .eq("id", newId)
        .single();
      expect(voided?.voided_at).not.toBeNull();
      expect(voided?.voided_by).toBe(exec.id);

      // Voiding twice is an error, not a silent no-op.
      const { error: twice } = await exec.client.rpc("void_score_entry", { p_entry_id: newId });
      expect(twice?.message).toContain("already voided");

      // set_active_semester is atomic: s1 off, s2 on, never both.
      await exec.client.rpc("set_active_semester", { p_semester_id: semester1 });
      await exec.client.rpc("set_active_semester", { p_semester_id: semester2 });
      const { data: active } = await admin.from("semesters").select("id").eq("is_active", true);
      expect(active?.map((r) => r.id)).toEqual([semester2]);
      await admin.from("semesters").update({ is_active: false }).eq("id", semester2);

      await admin.from("score_entries").delete().eq("id", newId);
    });

    it("rejects an award with no active semester and no explicit one", async () => {
      if (!exec) return;
      await admin.from("semesters").update({ is_active: false }).in("id", createdSemesterIds);
      const { error } = await exec.client.rpc("award_score", {
        p_project_id: projectA,
        p_points: 5,
        p_reason: "nowhere to land",
        p_awarded_on: null,
        p_semester_id: null,
      });
      // Only meaningful if the environment has no other active semester.
      const { data: anyActive } = await admin
        .from("semesters")
        .select("id")
        .eq("is_active", true)
        .limit(1);
      if ((anyActive ?? []).length === 0) {
        expect(error?.message).toContain("no active semester");
      }
    });
  });
});
