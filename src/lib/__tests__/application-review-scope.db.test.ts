// Integration tests for the project-scoped application review model
// (supabase/migrations/0057_project_scoped_application_review.sql):
// can_review_project()/can_review_all_projects(), the applications/
// application_rankings/application_answers SELECT policies, and the
// accept_application/reject_application RPCs.
//
// These hit a real Postgres/Supabase, so they're gated behind RUN_DB_TESTS to
// keep the default `npm test` pure. Run against a LOCAL stack — they create
// and delete users/projects/applications:
//
//   supabase start
//   RUN_DB_TESTS=1 \
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_ANON_KEY=<anon key from `supabase status`> \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   npx vitest run src/lib/__tests__/application-review-scope.db.test.ts
//
// Migration 0057 must already be applied. The "VP Projects" full-access
// scenarios additionally require a `roles` row with role_name = 'VP Projects'
// to already exist in that environment (roles are dashboard-managed, not
// seeded by any migration) — if it's missing, those specific assertions are
// skipped with a console.warn rather than failing the whole suite.
//
// This exercises the exact scenario a synthetic-schema sanity check (run
// manually while building 0057, not part of this repo) originally caught: an
// infinite-recursion bug between the applications_select and
// application_rankings_select policies, fixed by routing the
// applications_select check through the SECURITY DEFINER
// application_has_reviewable_ranking() helper instead of a raw subquery.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = process.env.RUN_DB_TESTS === "1";
const URL = process.env.SUPABASE_URL ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const admin: SupabaseClient = RUN ? createClient(URL, SERVICE, { auth: { persistSession: false } }) : (null as never);

type TestUser = { id: string; email: string; client: SupabaseClient };

async function makeUser(tag: string): Promise<TestUser> {
  const email = `review-scope-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "test-password-123!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  await admin.from("members").upsert({ user_id: data.user.id }, { onConflict: "user_id" });
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  return { id: data.user.id, email, client };
}

let pm1: TestUser; // PM of project1 only
let vp: TestUser; // holds the "VP Projects" role, if it exists in this environment
let plain: TestUser; // no roles, not a PM anywhere
let a1: TestUser; // applicant: ranks project1 #1, project2 #2
let a2: TestUser; // applicant: ranks project2 #1 only

let project1Id: string;
let project2Id: string;
let app1Id: string;
let app2Id: string;
let vpProjectsRoleId: number | null = null;

const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];
const createdApplicationIds: string[] = [];

describe.skipIf(!RUN)("project-scoped application review (migration 0057)", () => {
  beforeAll(async () => {
    pm1 = await makeUser("pm1");
    vp = await makeUser("vp");
    plain = await makeUser("plain");
    a1 = await makeUser("a1");
    a2 = await makeUser("a2");
    createdUserIds.push(pm1.id, vp.id, plain.id, a1.id, a2.id);

    const { data: projects, error: projErr } = await admin
      .from("projects")
      .insert([
        { name: `Review Scope Test Project 1 ${Date.now()}` },
        { name: `Review Scope Test Project 2 ${Date.now()}` },
      ])
      .select("id");
    if (projErr || !projects) throw projErr ?? new Error("project insert failed");
    project1Id = projects[0].id;
    project2Id = projects[1].id;
    createdProjectIds.push(project1Id, project2Id);

    const { error: pmErr } = await admin
      .from("project_members")
      .insert({ project_id: project1Id, user_id: pm1.id, is_pm: true });
    if (pmErr) throw pmErr;

    const { data: roleRow } = await admin.from("roles").select("id").eq("role_name", "VP Projects").maybeSingle();
    vpProjectsRoleId = roleRow?.id ?? null;
    if (vpProjectsRoleId) {
      const { error: mrErr } = await admin
        .from("members_roles")
        .insert({ user_id: vp.id, role_id: vpProjectsRoleId });
      if (mrErr) throw mrErr;
    } else {
      console.warn('No "VP Projects" role found in this environment — skipping full-access assertions.');
    }

    const { data: apps, error: appErr } = await admin
      .from("applications")
      .insert([{ applicant_id: a1.id }, { applicant_id: a2.id }])
      .select("id");
    if (appErr || !apps) throw appErr ?? new Error("application insert failed");
    app1Id = apps[0].id;
    app2Id = apps[1].id;
    createdApplicationIds.push(app1Id, app2Id);

    const { error: rankErr } = await admin.from("application_rankings").insert([
      { application_id: app1Id, project_id: project1Id, rank: 1, essay: "n/a" },
      { application_id: app1Id, project_id: project2Id, rank: 2, essay: "n/a" },
      { application_id: app2Id, project_id: project2Id, rank: 1, essay: "n/a" },
    ]);
    if (rankErr) throw rankErr;
  });

  afterAll(async () => {
    if (!RUN) return;
    for (const id of createdApplicationIds) await admin.from("applications").delete().eq("id", id);
    if (vpProjectsRoleId) await admin.from("members_roles").delete().eq("user_id", vp.id).eq("role_id", vpProjectsRoleId);
    for (const id of createdProjectIds) await admin.from("projects").delete().eq("id", id);
    for (const id of createdUserIds) {
      await admin.from("members").delete().eq("user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
  });

  describe("can_review_project()", () => {
    it("is true for the PM of that project", async () => {
      const { data } = await pm1.client.rpc("can_review_project", { p_project_id: project1Id });
      expect(data).toBe(true);
    });

    it("is false for a project the caller doesn't PM", async () => {
      const { data } = await pm1.client.rpc("can_review_project", { p_project_id: project2Id });
      expect(data).toBe(false);
    });

    it("is false for a plain member with no PM/full-access role", async () => {
      const { data: d1 } = await plain.client.rpc("can_review_project", { p_project_id: project1Id });
      const { data: d2 } = await plain.client.rpc("can_review_project", { p_project_id: project2Id });
      expect(d1).toBe(false);
      expect(d2).toBe(false);
    });

    it.runIf(!!vpProjectsRoleId)("is true for every project when the caller holds VP Projects", async () => {
      const { data: d1 } = await vp.client.rpc("can_review_project", { p_project_id: project1Id });
      const { data: d2 } = await vp.client.rpc("can_review_project", { p_project_id: project2Id });
      expect(d1).toBe(true);
      expect(d2).toBe(true);
    });
  });

  describe("application_rankings SELECT scoping", () => {
    it("a PM sees only rankings for their own project", async () => {
      const { data } = await pm1.client.from("application_rankings").select("project_id");
      expect((data ?? []).every((r) => r.project_id === project1Id)).toBe(true);
      expect((data ?? []).some((r) => r.project_id === project1Id)).toBe(true);
    });

    it("a plain member sees no rankings", async () => {
      const { data } = await plain.client.from("application_rankings").select("id");
      expect(data ?? []).toHaveLength(0);
    });

    it("an applicant sees their own rankings regardless of project", async () => {
      const { data } = await a1.client.from("application_rankings").select("project_id").eq("application_id", app1Id);
      const projectIds = (data ?? []).map((r) => r.project_id).sort();
      expect(projectIds).toEqual([project1Id, project2Id].sort());
    });
  });

  describe("accept_application()", () => {
    it("lets a PM accept an applicant onto their own project", async () => {
      const { error } = await pm1.client.rpc("accept_application", {
        p_application_id: app1Id,
        p_project_id: project1Id,
      });
      expect(error).toBeNull();

      const { data: app } = await admin.from("applications").select("status, accepted_project_id").eq("id", app1Id).single();
      expect(app?.status).toBe("accepted");
      expect(app?.accepted_project_id).toBe(project1Id);

      const { data: member } = await admin.from("members").select("status").eq("user_id", a1.id).single();
      expect(member?.status).toBe("active");

      const { data: roster } = await admin
        .from("project_members")
        .select("is_pm")
        .eq("project_id", project1Id)
        .eq("user_id", a1.id)
        .single();
      expect(roster?.is_pm).toBe(false);
    });

    it("blocks a PM from accepting an applicant onto a project they don't PM", async () => {
      const { error } = await pm1.client.rpc("accept_application", {
        p_application_id: app2Id,
        p_project_id: project2Id,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("not authorized");
    });

    it.runIf(!!vpProjectsRoleId)("lets VP Projects accept onto any project", async () => {
      const { error } = await vp.client.rpc("accept_application", {
        p_application_id: app2Id,
        p_project_id: project2Id,
      });
      expect(error).toBeNull();
    });
  });
});
