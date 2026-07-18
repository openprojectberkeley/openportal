"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8am–8pm
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REQUIRED_PER_WEEK = 5;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Fallback window used only until VP Tech configures one (or the app_settings
// row is missing). Months are 0-indexed, so (2026, 7, 1) = Aug 1, 2026.
const DEFAULT_RANGE_START = new Date(2026, 7, 1);
const DEFAULT_RANGE_END = new Date(2026, 7, 31);

function formatHour(h: number): string {
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

// Monday (local midnight) of the week containing `date`.
function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Number of week columns (Mon–Sun) spanning [start, end] inclusive.
function weekCountFor(start: Date, end: Date): number {
  return Math.max(1, Math.round((mondayOf(end).getTime() - mondayOf(start).getTime()) / WEEK_MS) + 1);
}

// 'YYYY-MM-DD' (local) <-> Date, matching a Postgres `date` column and the
// value format of <input type="date">.
function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function slotKey(date: Date, hour: number): string {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

type UpcomingSlot = {
  meeting_time: string;
  capacity: number;
  filled: number;
  attendees: { name: string; user_id: string; email: string | null }[];
};

export default function ManagerCoffeeChatsPage() {
  // Exec availability holds more attendees per slot than board (PM). Only real
  // VP Tech (viewing as themselves) may edit the bookable window.
  const { isExec, canSimulate, persona } = useRoleSim();
  const slotCapacity = isExec ? 5 : 3;
  const canEditWindow = canSimulate && persona === "exec";

  const [upcomingSlots, setUpcomingSlots] = useState<UpcomingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  // Bookable window (loaded from app_settings; falls back to the defaults).
  const [rangeStart, setRangeStart] = useState<Date>(DEFAULT_RANGE_START);
  const [rangeEnd, setRangeEnd] = useState<Date>(DEFAULT_RANGE_END);
  const [settingsReady, setSettingsReady] = useState(false);
  const [draftStart, setDraftStart] = useState(toDateInputValue(DEFAULT_RANGE_START));
  const [draftEnd, setDraftEnd] = useState(toDateInputValue(DEFAULT_RANGE_END));
  const [savingWindow, setSavingWindow] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);

  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dbTimes, setDbTimes] = useState<Set<string>>(new Set());
  const [bookedTimes, setBookedTimes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Load the configured window once, then open on the week containing today.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("app_settings")
      .select("coffee_chat_start, coffee_chat_end")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        const start = data?.coffee_chat_start ? parseLocalDate(data.coffee_chat_start) : DEFAULT_RANGE_START;
        const end = data?.coffee_chat_end ? parseLocalDate(data.coffee_chat_end) : DEFAULT_RANGE_END;
        setRangeStart(start);
        setRangeEnd(end);
        setDraftStart(toDateInputValue(start));
        setDraftEnd(toDateInputValue(end));
        const wc = weekCountFor(start, end);
        setWeekOffset(
          Math.min(wc - 1, Math.max(0, Math.round((mondayOf(new Date()).getTime() - mondayOf(start).getTime()) / WEEK_MS))),
        );
        setSettingsReady(true);
      });
  }, []);

  const copyEmail = async (key: string, email: string | null) => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // Clipboard unavailable (e.g. non-secure context) — nothing to do.
    }
  };

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: rows } = await supabase
      .from("coffee_chats")
      .select("meeting_time, applicant_id")
      .eq("member_id", user.id)
      .gte("meeting_time", rangeStart.toISOString())
      .lt("meeting_time", addDays(rangeEnd, 1).toISOString())
      .order("meeting_time", { ascending: true });

    if (!rows?.length) {
      setUpcomingSlots([]);
      setDbTimes(new Set());
      setBookedTimes(new Set());
      setSelected(new Set());
      setLoading(false);
      return;
    }

    // Build upcoming slots grouped by meeting_time
    const grouped = new Map<string, (string | null)[]>();
    for (const row of rows) {
      if (!grouped.has(row.meeting_time)) grouped.set(row.meeting_time, []);
      grouped.get(row.meeting_time)!.push(row.applicant_id);
    }

    const applicantIds = [...new Set(rows.map((r) => r.applicant_id).filter((id): id is string => id !== null))];
    const nameMap = new Map<string, string>();
    const emailMap = new Map<string, string | null>();
    if (applicantIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname, email")
        .in("user_id", applicantIds);
      for (const m of members ?? []) {
        nameMap.set(m.user_id, [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Unknown");
        emailMap.set(m.user_id, m.email ?? null);
      }
    }

    const nowMs = Date.now();
    const upcoming: UpcomingSlot[] = [];
    for (const [meeting_time, ids] of grouped) {
      // Past meetings stay visible in the grid but drop off the "Upcoming" list.
      if (new Date(meeting_time).getTime() < nowMs) continue;
      const filled = ids.filter((id): id is string => id !== null);
      upcoming.push({
        meeting_time,
        capacity: ids.length,
        filled: filled.length,
        attendees: filled.map((id) => ({ user_id: id, name: nameMap.get(id) ?? "Unknown", email: emailMap.get(id) ?? null })),
      });
    }
    setUpcomingSlots(upcoming);

    // Pre-populate availability grid — normalize timestamps so they match
    // the ISO keys the grid generates via slotKey().
    const dbSet = new Set(rows.map((r) => new Date(r.meeting_time).toISOString()));
    const bookedSet = new Set(
      rows.filter((r) => r.applicant_id !== null).map((r) => new Date(r.meeting_time).toISOString())
    );
    setDbTimes(dbSet);
    setBookedTimes(bookedSet);
    setSelected(new Set(dbSet));
    setLoading(false);
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    if (settingsReady) load();
  }, [load, settingsReady]);

  // Window-derived grid geometry (recomputed when the range changes).
  const rangeEndExclusive = addDays(rangeEnd, 1);
  const firstMonday = mondayOf(rangeStart);
  const weekCount = weekCountFor(rangeStart, rangeEnd);
  const weekStart = addDays(firstMonday, weekOffset * 7);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();

  const inRange = (date: Date): boolean => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d >= rangeStart && d < rangeEndExclusive;
  };

  const isPast = (date: Date, hour: number) => {
    const t = new Date(date);
    t.setHours(hour, 0, 0, 0);
    return t < now;
  };

  const windowDirty = draftStart !== toDateInputValue(rangeStart) || draftEnd !== toDateInputValue(rangeEnd);

  const saveWindow = async () => {
    setWindowError(null);
    if (!draftStart || !draftEnd) { setWindowError("Pick both dates."); return; }
    const start = parseLocalDate(draftStart);
    const end = parseLocalDate(draftEnd);
    if (start > end) { setWindowError("Start date must be on or before end date."); return; }

    setSavingWindow(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ id: 1, coffee_chat_start: draftStart, coffee_chat_end: draftEnd, updated_at: new Date().toISOString() });

    if (error) { setWindowError(error.message); setSavingWindow(false); return; }

    setRangeStart(start);
    setRangeEnd(end);
    setWeekOffset((w) => Math.min(weekCountFor(start, end) - 1, Math.max(0, w)));
    setSavingWindow(false);
  };

  const toggleSlot = (key: string, date: Date, hour: number) => {
    if (!inRange(date) || isPast(date, hour) || bookedTimes.has(key)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const slotInfo = new Map<string, UpcomingSlot>();
  for (const s of upcomingSlots) slotInfo.set(new Date(s.meeting_time).toISOString(), s);

  const weekSelectedCount = weekDates.reduce(
    (count, date) => count + HOURS.filter((h) => selected.has(slotKey(date, h))).length,
    0
  );

  const hasChanges = (() => {
    for (const k of selected) if (!dbTimes.has(k)) return true;
    for (const k of dbTimes) if (!selected.has(k) && !bookedTimes.has(k)) return true;
    return false;
  })();

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const toInsert = [...selected].filter((k) => !dbTimes.has(k));
    const toDelete = [...dbTimes].filter((k) => !selected.has(k) && !bookedTimes.has(k));

    if (toInsert.length > 0) {
      await supabase.from("coffee_chats").insert(
        toInsert.flatMap((meeting_time) =>
          Array.from({ length: slotCapacity }, () => ({
            member_id: user.id,
            meeting_time,
            applicant_id: null,
            complete: false,
          }))
        )
      );
    }

    for (const meeting_time of toDelete) {
      await supabase
        .from("coffee_chats")
        .delete()
        .eq("member_id", user.id)
        .eq("meeting_time", meeting_time)
        .is("applicant_id", null);
    }

    // Re-fetch so the grid and upcoming list reflect the saved state.
    await load();
    setSaving(false);
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <Link href="/apply/manager" className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <h1 className="text-2xl font-bold">Coffee Chats</h1>
      </div>

      {/* Bookable window — VP Tech only */}
      {canEditWindow && (
        <div className="flex flex-col gap-3 border rounded-xl p-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Coffee Chat Window</h2>
            <p className="text-xs text-muted-foreground">
              The date range everyone can set availability within. Applies to all managers.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Start
              <input
                type="date"
                value={draftStart}
                max={draftEnd || undefined}
                onChange={(e) => setDraftStart(e.target.value)}
                className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              End
              <input
                type="date"
                value={draftEnd}
                min={draftStart || undefined}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <button
              onClick={saveWindow}
              disabled={savingWindow || !windowDirty}
              className="rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-30"
            >
              {savingWindow ? "Saving…" : "Save window"}
            </button>
          </div>
          {windowError && <p className="text-sm text-red-500">{windowError}</p>}
        </div>
      )}

      {/* Availability grid */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your Availability</h2>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium tabular-nums ${weekSelectedCount >= REQUIRED_PER_WEEK ? "text-green-600" : "text-amber-500"}`}>
              {weekSelectedCount} / {REQUIRED_PER_WEEK} hrs this week
            </span>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-30"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Week nav */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
            disabled={weekOffset === 0}
            className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium">
            {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {" – "}
            {weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <button
            onClick={() => setWeekOffset((w) => Math.min(weekCount - 1, w + 1))}
            disabled={weekOffset >= weekCount - 1}
            className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {/* Day headers */}
            <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-1 mb-1">
              <div />
              {weekDates.map((date, i) => (
                <div key={i} className="text-center">
                  <p className="text-xs text-muted-foreground">{DAY_LABELS[i]}</p>
                  <p className={`text-sm font-semibold ${date.toDateString() === now.toDateString() ? "text-blue-500" : ""}`}>
                    {date.getDate()}
                  </p>
                </div>
              ))}
            </div>

            {/* Hour rows */}
            <div className="flex flex-col gap-0.5">
              {HOURS.map((hour) => (
                <div key={hour} className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-1">
                  <div className="flex items-center justify-end pr-2">
                    <span className="text-xs text-muted-foreground">{formatHour(hour)}</span>
                  </div>
                  {weekDates.map((date, di) => {
                    const key = slotKey(date, hour);
                    const outOfRange = !inRange(date);
                    const past = isPast(date, hour);
                    const booked = bookedTimes.has(key);
                    const sel = selected.has(key);
                    const info = slotInfo.get(key);

                    return (
                      <div key={di} className="relative group">
                        <button
                          disabled={outOfRange || past}
                          onClick={() => toggleSlot(key, date, hour)}
                          className={`h-7 w-full rounded-sm border text-xs transition-colors ${
                            booked
                              ? "bg-blue-500 border-blue-600 cursor-not-allowed"
                              : outOfRange
                              ? "opacity-10 cursor-not-allowed bg-foreground/5 border-transparent"
                              : past
                              ? sel
                                ? "bg-white/70 border-foreground/60 cursor-not-allowed"
                                : "opacity-20 cursor-not-allowed bg-foreground/5 border-transparent"
                              : sel
                              ? "bg-white border-foreground"
                              : "border-border hover:bg-accent"
                          }`}
                        />
                        {info && (
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-max max-w-[12rem] -translate-x-1/2 flex-col gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-background shadow-lg group-hover:flex">
                            <span className="text-xs font-semibold tabular-nums">
                              {info.filled}/{info.capacity} booked
                            </span>
                            {info.attendees.length > 0 ? (
                              <span className="text-[11px] leading-snug">
                                {info.attendees.map((a) => a.name).join(", ")}
                              </span>
                            ) : (
                              <span className="text-[11px] italic opacity-70">No attendees yet</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-white border border-foreground" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" /> Booked
          </span>
        </div>
      </div>

      {/* Upcoming coffee chats */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : upcomingSlots.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</h2>
          {upcomingSlots.map((slot) => {
            const d = new Date(slot.meeting_time);
            return (
              <div key={slot.meeting_time} className="border rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${slot.filled === slot.capacity ? "text-red-500" : "text-green-600"}`}>
                    {slot.filled}/{slot.capacity}
                  </span>
                </div>
                {slot.attendees.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {slot.attendees.map((a) => {
                      const copyKey = `${slot.meeting_time}-${a.user_id}`;
                      const copied = copiedKey === copyKey;
                      return (
                        <button
                          key={a.user_id}
                          type="button"
                          onClick={() => copyEmail(copyKey, a.email)}
                          title={a.email ? "Click to copy email" : undefined}
                          className="group relative px-2 py-0.5 rounded-full bg-foreground/10 text-xs font-medium hover:bg-foreground/20 transition-colors"
                        >
                          {a.name}
                          <span
                            className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[16rem] -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] text-background shadow-lg ${
                              copied ? "block" : "hidden group-hover:block"
                            }`}
                          >
                            {copied ? "Email copied!" : a.email ?? "No email on file"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No attendees yet.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
