"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isReturningMember, type MemberStatus } from "@/lib/member-status";
import { TECH_AREAS, TECH_CLASSES, TECH_CLASS_NA } from "@/lib/application-profile";
import { undraftedIds } from "@/lib/draft-status";

// Everything the exec analytics modal shows, fetched in one parallel round and
// aggregated client-side (no analytics migration: the existing RPCs give the
// requirement checks and rank counts, plain table reads give the rest).
//
// Conventions shared by every number below:
//   * exec_added applications (people put on the draft board without applying,
//     0096) are not applicants and are left out of applicant stats.
//   * "Applicants" = submitted applications (submitted | accepted | rejected).
//   * "Drafted" = a pick under a confirmed (submitted_at set) round project.
//   * "On a team" = a drafted applicant with a non-PM project_members row for
//     the project that picked them (membership is what the board reports, 0106).
//   * "Returning" = members.status active|inactive *today*, not at apply time.

// ---- raw rows -------------------------------------------------------------

type PeriodRow = {
  period_id: string;
  period_name: string;
  created_at: string;
  submitted: number;
  accepted: number;
  rejected: number;
  both_valid?: number;
};

type AppRow = {
  id: string;
  applicant_id: string;
  period_id: string;
  status: "draft" | "submitted" | "accepted" | "rejected";
  exec_added: boolean;
  accepted_project_id: string | null;
};

type ProfileRow = {
  id: string;
  tech_area_rankings: Record<string, number> | null;
  tech_classes: string[] | null;
  portfolio_url: string | null;
};

type MemberRow = {
  user_id: string;
  major: string | null;
  grad_year: string | null;
  status: MemberStatus | null;
  resume_path: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  type: string | null;
  color: string | null;
  estimated_members: number | null;
};

type RoundRow = {
  period_id: string;
  draft_round_projects: {
    project_id: string;
    pick_count: number;
    submitted_at: string | null;
    draft_picks: { application_id: string }[];
  }[];
};

type RankRow = { project_id: string; project_name: string; project_type: string; rank: number; cnt: number };

export type InvalidRow = {
  applicant_id: string;
  preferred_firstname: string | null;
  lastname: string | null;
  is_returning: boolean;
  did_complete: boolean;
  has_chat: boolean;
  did_att: boolean;
};

type Raw = {
  periods: PeriodRow[];
  apps: AppRow[];
  profiles: ProfileRow[];
  members: MemberRow[];
  projects: ProjectRow[];
  memberships: { project_id: string; user_id: string; is_pm: boolean; created_at: string }[];
  rounds: RoundRow[];
  ranks: RankRow[];
  invalid: InvalidRow[];
};

// ---- derived shape --------------------------------------------------------

export type Count = { label: string; count: number };

export type RecruitingAnalytics = {
  periodName: string;
  previousName: string | null;
  headline: {
    applicants: number;
    applicantsDelta: number | null;
    drafted: number;
    onTeam: number;
    returning: number;
    meetsRequirements: number;
    /** Denominator for meetsRequirements: submitted + accepted (rejected excluded, as in the RPC). */
    considered: number;
  };
  funnel: { label: string; count: number; hint?: string }[];
  undrafted: {
    total: number;
    missingCoffee: number;
    missingInfo: number;
    missingBoth: number;
    metNotPicked: number;
  };
  invalid: InvalidRow[];
  applicants: {
    total: number;
    classYears: Count[];
    majors: Count[];
    otherMajors: { count: number; distinct: number };
    interests: { key: string; label: string; avg: number; high: number; answered: number }[];
    classes: Count[];
    withResume: number;
    withPortfolio: number;
  };
  retention: {
    periods: {
      id: string;
      name: string;
      applicants: number;
      returning: number;
      repeat: number;
      drafted: number;
      accepted: number;
    }[];
    cameBack: { previousAccepted: number; applied: number } | null;
    acceptance: { newApplicants: number; newAccepted: number; returningApplicants: number; returningAccepted: number };
  };
  projects: {
    rows: {
      id: string;
      name: string;
      type: string | null;
      color: string | null;
      capacity: number | null;
      firsts: number;
      rankings: number;
      byRank: Record<number, number>;
      offered: number;
      drafted: number;
      accepted: number;
    }[];
    maxRank: number;
    byType: { type: string; projects: number; firsts: number; offered: number; drafted: number; accepted: number }[];
  };
};

const CLASS_YEARS = ["Freshman", "Sophomore", "Junior", "Senior", "Postgrad"];

const SUBMITTED = new Set(["submitted", "accepted", "rejected"]);

// Majors are free text ("CS + Econ", "Applied Mathematics (intended)", "DS/ECON"),
// so fold the spellings people actually use into one label per major.
const MAJOR_PHRASES: [RegExp, string][] = [
  [/electrical (?:engineering )?(?:and|&) computer (?:sciences?|engineering)/g, "eecs"],
  [/industrial engineering (?:and|&) operations research/g, "ieor"],
  [/environmental economics (?:and|&) policy/g, "eep"],
];
const MAJOR_ALIASES: [RegExp, string][] = [
  [/^(cs|comp ?sci|computer science)$/, "Computer Science"],
  [/^eecs$/, "EECS"],
  [/^(ds|data sci\w*|data sci\w* \w+)$/, "Data Science"],
  [/^applied math(ematics)?$/, "Applied Math"],
  [/^math(ematics)?$/, "Math"],
  [/^stat\w*$/, "Statistics"],
  [/^econ(omics)?$/, "Economics"],
  [/^(cog ?sci|cognitive( sci\w*)?)$/, "Cognitive Science"],
  [/^ieor$/, "IEOR"],
  [/^eep$/, "Environmental Economics & Policy"],
  [/^business( administration)?$/, "Business"],
  [/^mcb$/, "MCB"],
  [/^(undeclared|undecided)( \w+)?$/, "Undeclared"],
];
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function normalizeMajors(raw: string): string[] {
  let s = raw.toLowerCase();
  for (const [re, to] of MAJOR_PHRASES) s = s.replace(re, to);
  return s
    .split(/[,/+&;()]| and | or /)
    .filter((part) => !/minor|cluster/.test(part))
    .map((part) =>
      part
        .replace(/\b(intended|double|major|also)\b|[?\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        // "Undecided, intended Data Science" -> Data Science.
        .replace(/^(undecided|undeclared) (?=\w+ \w+)/, ""),
    )
    .filter(Boolean)
    .map((part) => MAJOR_ALIASES.find(([re]) => re.test(part))?.[1] ?? titleCase(part));
}

// PostgREST caps a response at 1000 rows; page until a short page comes back.
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

async function load(periodId: string): Promise<Raw> {
  const supabase = createClient();
  const unwrap = <T,>(res: { data: unknown; error: { message: string } | null }): T => {
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []) as T;
  };

  const [periods, apps, profiles, members, projects, memberships, rounds, ranks, invalid] = await Promise.all([
    supabase.rpc("application_analytics").then((r) => unwrap<PeriodRow[]>(r)),
    fetchAll<AppRow>((a, b) =>
      supabase.from("applications").select("id, applicant_id, period_id, status, exec_added, accepted_project_id").order("id").range(a, b),
    ),
    fetchAll<ProfileRow>((a, b) =>
      supabase
        .from("applications")
        .select("id, tech_area_rankings, tech_classes, portfolio_url")
        .eq("period_id", periodId)
        .eq("exec_added", false)
        .in("status", ["submitted", "accepted", "rejected"])
        .order("id")
        .range(a, b),
    ),
    fetchAll<MemberRow>((a, b) =>
      supabase.from("members").select("user_id, major, grad_year, status, resume_path").order("user_id").range(a, b),
    ),
    supabase
      .from("projects")
      .select("id, name, type, color, estimated_members")
      .then((r) => unwrap<ProjectRow[]>(r)),
    fetchAll<Raw["memberships"][number]>((a, b) =>
      supabase.from("project_members").select("project_id, user_id, is_pm, created_at").order("id").range(a, b),
    ),
    supabase
      .from("draft_rounds")
      .select("period_id, draft_round_projects(project_id, pick_count, submitted_at, draft_picks(application_id))")
      .then((r) => unwrap<RoundRow[]>(r)),
    supabase.rpc("application_project_rankings", { p_period_id: periodId }).then((r) => unwrap<RankRow[]>(r)),
    supabase.rpc("application_analytics_invalid", { p_period_id: periodId }).then((r) => unwrap<InvalidRow[]>(r)),
  ]);

  return { periods, apps, profiles, members, projects, memberships, rounds, ranks, invalid };
}

function derive(raw: Raw, periodId: string): RecruitingAnalytics | null {
  // Oldest → newest, so "earlier period" and "previous period" are index lookups.
  const periods = [...raw.periods].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const pIndex = periods.findIndex((p) => p.period_id === periodId);
  if (pIndex < 0) return null;
  const period = periods[pIndex];
  const previous = pIndex > 0 ? periods[pIndex - 1] : null;
  const orderOf = new Map(periods.map((p, i) => [p.period_id, i]));

  const memberById = new Map(raw.members.map((m) => [m.user_id, m]));
  // members.status is today's state, so everyone accepted this cycle reads as
  // "returning". Use history where we have it: returning in period i = accepted
  // in an earlier period, on a project team before period i opened, or a member
  // today with no acceptance in period i or later (pre-portal members, people
  // placed outside the application flow).
  const acceptedAt = new Map<string, number[]>();
  for (const a of raw.apps) {
    if (a.exec_added || a.status !== "accepted") continue;
    const i = orderOf.get(a.period_id);
    if (i === undefined) continue;
    acceptedAt.set(a.applicant_id, [...(acceptedAt.get(a.applicant_id) ?? []), i]);
  }
  const isReturningAt = (uid: string, i: number) => {
    const acc = acceptedAt.get(uid) ?? [];
    if (acc.some((x) => x < i)) return true;
    const onTeam = firstOnTeam.get(uid);
    if (onTeam && onTeam < periods[i].created_at) return true;
    return isReturningMember(memberById.get(uid)?.status ?? null) && !acc.some((x) => x >= i);
  };
  const isReturning = (uid: string) => isReturningAt(uid, pIndex);
  const appById = new Map(raw.apps.map((a) => [a.id, a]));
  const membership = new Set(raw.memberships.filter((m) => !m.is_pm).map((m) => `${m.project_id}:${m.user_id}`));
  // Earliest project membership (PM or not) per person.
  const firstOnTeam = new Map<string, string>();
  for (const m of raw.memberships) {
    const prev = firstOnTeam.get(m.user_id);
    if (!prev || m.created_at < prev) firstOnTeam.set(m.user_id, m.created_at);
  }

  const realApps = raw.apps.filter((a) => !a.exec_added);
  const appsByPeriod = new Map<string, AppRow[]>();
  for (const a of realApps) {
    const list = appsByPeriod.get(a.period_id) ?? [];
    list.push(a);
    appsByPeriod.set(a.period_id, list);
  }
  const submittedIn = (pid: string) => (appsByPeriod.get(pid) ?? []).filter((a) => SUBMITTED.has(a.status));

  // First period index each person submitted in, for "repeat applicant".
  const firstApplied = new Map<string, number>();
  for (const a of realApps) {
    if (!SUBMITTED.has(a.status)) continue;
    const i = orderOf.get(a.period_id);
    if (i === undefined) continue;
    const prev = firstApplied.get(a.applicant_id);
    if (prev === undefined || i < prev) firstApplied.set(a.applicant_id, i);
  }

  // Confirmed picks, per period: application → picking project(s).
  const draftedByPeriod = new Map<string, Map<string, Set<string>>>();
  for (const r of raw.rounds) {
    for (const rp of r.draft_round_projects ?? []) {
      if (!rp.submitted_at) continue;
      for (const pick of rp.draft_picks ?? []) {
        const m = draftedByPeriod.get(r.period_id) ?? new Map<string, Set<string>>();
        const s = m.get(pick.application_id) ?? new Set<string>();
        s.add(rp.project_id);
        m.set(pick.application_id, s);
        draftedByPeriod.set(r.period_id, m);
      }
    }
  }
  const draftedIn = (pid: string) => draftedByPeriod.get(pid) ?? new Map<string, Set<string>>();
  const isOnTeam = (appId: string, projectIds: Set<string>) => {
    const uid = appById.get(appId)?.applicant_id;
    return !!uid && [...projectIds].some((p) => membership.has(`${p}:${uid}`));
  };

  // ---- current period ----------------------------------------------------
  const started = appsByPeriod.get(periodId) ?? [];
  const submitted = submittedIn(periodId);
  const drafted = draftedIn(periodId);
  const draftedApplicants = submitted.filter((a) => drafted.has(a.id));
  const onTeam = draftedApplicants.filter((a) => isOnTeam(a.id, drafted.get(a.id)!));
  const returning = submitted.filter((a) => isReturning(a.applicant_id));
  const considered = period.submitted + period.accepted;
  const meets = period.both_valid ?? 0;

  // Why undrafted: the same "not drafted" rule as the board and draft page
  // (src/lib/draft-status.ts): eligible, no confirmed pick, not placed.
  const invalidById = new Map(raw.invalid.map((r) => [r.applicant_id, r]));
  const memberKeysUserFirst = new Set(
    raw.memberships.filter((m) => !m.is_pm).map((m) => `${m.user_id}:${m.project_id}`),
  );
  const undraftedSet = undraftedIds(started, new Set(drafted.keys()), memberKeysUserFirst);
  const pool = started.filter((a) => undraftedSet.has(a.id));
  const undrafted = { total: pool.length, missingCoffee: 0, missingInfo: 0, missingBoth: 0, metNotPicked: 0 };
  for (const a of pool) {
    const inv = invalidById.get(a.applicant_id);
    if (!inv) undrafted.metNotPicked++;
    else if (!inv.did_complete && !inv.did_att) undrafted.missingBoth++;
    else if (!inv.did_complete) undrafted.missingCoffee++;
    else undrafted.missingInfo++;
  }

  // ---- applicants ---------------------------------------------------------
  const profileById = new Map(raw.profiles.map((p) => [p.id, p]));
  const people = submitted.map((a) => ({ app: a, member: memberById.get(a.applicant_id), profile: profileById.get(a.id) }));

  const yearCounts = new Map<string, number>();
  for (const p of people) {
    const y = p.member?.grad_year?.trim() || "Unknown";
    yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
  }
  const yearRank = (y: string) => {
    const i = CLASS_YEARS.indexOf(y);
    return i >= 0 ? i : y === "Unknown" ? 99 : 50;
  };
  const classYears = [...yearCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => yearRank(a.label) - yearRank(b.label) || a.label.localeCompare(b.label));

  const majorCounts = new Map<string, number>();
  for (const p of people) {
    const majors = new Set(normalizeMajors(p.member?.major ?? ""));
    for (const m of majors) majorCounts.set(m, (majorCounts.get(m) ?? 0) + 1);
  }
  const majorList = [...majorCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const majors = majorList.slice(0, 8);
  const rest = majorList.slice(8);

  const interests = TECH_AREAS.map((area) => {
    let sum = 0;
    let answered = 0;
    let high = 0;
    for (const p of people) {
      const v = Number(p.profile?.tech_area_rankings?.[area.key]);
      if (!Number.isFinite(v) || v < 1) continue;
      sum += v;
      answered++;
      if (v >= 4) high++;
    }
    return { key: area.key, label: area.label, avg: answered ? sum / answered : 0, high, answered };
  }).sort((a, b) => b.avg - a.avg);

  const classes = TECH_CLASSES.map((c) => ({
    label: c.key === TECH_CLASS_NA ? "None of these" : c.label,
    count: people.filter((p) => (p.profile?.tech_classes ?? []).includes(c.key)).length,
  })).sort((a, b) => b.count - a.count);

  // ---- retention ----------------------------------------------------------
  const retentionPeriods = [...periods].reverse().map((p) => {
    const subs = submittedIn(p.period_id);
    const d = draftedIn(p.period_id);
    const i = orderOf.get(p.period_id)!;
    return {
      id: p.period_id,
      name: p.period_name,
      applicants: subs.length,
      returning: subs.filter((a) => isReturningAt(a.applicant_id, i)).length,
      repeat: subs.filter((a) => (firstApplied.get(a.applicant_id) ?? i) < i).length,
      drafted: subs.filter((a) => d.has(a.id)).length,
      accepted: subs.filter((a) => a.status === "accepted").length,
    };
  });

  let cameBack: RecruitingAnalytics["retention"]["cameBack"] = null;
  if (previous) {
    const prevAccepted = new Set(submittedIn(previous.period_id).filter((a) => a.status === "accepted").map((a) => a.applicant_id));
    const nowApplied = new Set(submitted.map((a) => a.applicant_id));
    cameBack = { previousAccepted: prevAccepted.size, applied: [...prevAccepted].filter((u) => nowApplied.has(u)).length };
  }

  const acceptance = { newApplicants: 0, newAccepted: 0, returningApplicants: 0, returningAccepted: 0 };
  for (const a of submitted) {
    const ret = isReturning(a.applicant_id);
    const acc = a.status === "accepted";
    if (ret) {
      acceptance.returningApplicants++;
      if (acc) acceptance.returningAccepted++;
    } else {
      acceptance.newApplicants++;
      if (acc) acceptance.newAccepted++;
    }
  }

  // ---- projects -----------------------------------------------------------
  const projectById = new Map(raw.projects.map((p) => [p.id, p]));
  type PRow = RecruitingAnalytics["projects"]["rows"][number];
  const rows = new Map<string, PRow>();
  const row = (id: string, fallbackName?: string, fallbackType?: string): PRow => {
    let r = rows.get(id);
    if (!r) {
      const p = projectById.get(id);
      r = {
        id,
        name: p?.name ?? fallbackName ?? "Unknown project",
        type: p?.type ?? fallbackType ?? null,
        color: p?.color ?? null,
        capacity: p?.estimated_members && p.estimated_members > 0 ? p.estimated_members : null,
        firsts: 0,
        rankings: 0,
        byRank: {},
        offered: 0,
        drafted: 0,
        accepted: 0,
      };
      rows.set(id, r);
    }
    return r;
  };
  let maxRank = 0;
  for (const rk of raw.ranks) {
    const r = row(rk.project_id, rk.project_name, rk.project_type);
    r.byRank[rk.rank] = (r.byRank[rk.rank] ?? 0) + rk.cnt;
    r.rankings += rk.cnt;
    if (rk.rank === 1) r.firsts += rk.cnt;
    maxRank = Math.max(maxRank, rk.rank);
  }
  for (const round of raw.rounds) {
    if (round.period_id !== periodId) continue;
    for (const rp of round.draft_round_projects ?? []) {
      const r = row(rp.project_id);
      r.offered += rp.pick_count;
      if (!rp.submitted_at) continue;
      for (const pick of rp.draft_picks ?? []) {
        r.drafted++;
        const uid = appById.get(pick.application_id)?.applicant_id;
        if (uid && membership.has(`${rp.project_id}:${uid}`)) r.accepted++;
      }
    }
  }
  const ratio = (r: PRow) => (r.capacity ? r.firsts / r.capacity : -1);
  const projectRows = [...rows.values()].sort(
    (a, b) => ratio(b) - ratio(a) || b.firsts - a.firsts || a.name.localeCompare(b.name),
  );
  const typeMap = new Map<string, RecruitingAnalytics["projects"]["byType"][number]>();
  for (const r of projectRows) {
    const t = r.type ?? "other";
    const agg = typeMap.get(t) ?? { type: t, projects: 0, firsts: 0, offered: 0, drafted: 0, accepted: 0 };
    agg.projects++;
    agg.firsts += r.firsts;
    agg.offered += r.offered;
    agg.drafted += r.drafted;
    agg.accepted += r.accepted;
    typeMap.set(t, agg);
  }

  return {
    periodName: period.period_name,
    previousName: previous?.period_name ?? null,
    headline: {
      applicants: submitted.length,
      applicantsDelta: previous ? submitted.length - submittedIn(previous.period_id).length : null,
      drafted: draftedApplicants.length,
      onTeam: onTeam.length,
      returning: returning.length,
      meetsRequirements: meets,
      considered,
    },
    funnel: [
      { label: "Started", count: started.length, hint: "Opened an application, including empty drafts." },
      { label: "Submitted", count: submitted.length },
      {
        label: "Meets requirements",
        count: meets,
        hint: "Coffee chat completed and info session attended, or returning / board / exec. Rejected applications are not counted.",
      },
      { label: "Drafted", count: draftedApplicants.length, hint: "Picked in a confirmed draft round." },
      { label: "On a team", count: onTeam.length, hint: "Drafted and now a member of the project that picked them." },
    ],
    undrafted,
    invalid: raw.invalid,
    applicants: {
      total: people.length,
      classYears,
      majors,
      otherMajors: { count: rest.reduce((s, m) => s + m.count, 0), distinct: rest.length },
      interests,
      classes,
      withResume: people.filter((p) => !!p.member?.resume_path).length,
      withPortfolio: people.filter((p) => !!p.profile?.portfolio_url?.trim()).length,
    },
    retention: { periods: retentionPeriods, cameBack, acceptance },
    projects: { rows: projectRows, maxRank, byType: [...typeMap.values()].sort((a, b) => a.type.localeCompare(b.type)) },
  };
}

export function useRecruitingAnalytics(periodId: string | null) {
  const [state, setState] = useState<{ key: string | null; raw: Raw | null; error: string | null }>({
    key: null,
    raw: null,
    error: null,
  });

  useEffect(() => {
    if (!periodId) return;
    let cancelled = false;
    load(periodId).then(
      (raw) => !cancelled && setState({ key: periodId, raw, error: null }),
      (e: unknown) =>
        !cancelled &&
        setState({ key: periodId, raw: null, error: e instanceof Error ? e.message : "Couldn't load analytics." }),
    );
    return () => {
      cancelled = true;
    };
  }, [periodId]);

  const current = state.key === periodId;
  const data = useMemo(
    () => (current && state.raw && periodId ? derive(state.raw, periodId) : null),
    [current, state.raw, periodId],
  );

  return {
    data,
    loading: !!periodId && !current,
    error: current ? state.error : null,
  };
}

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
