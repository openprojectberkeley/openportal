"use client";

import { createClient } from "@/lib/supabase/client";
import { fetchBusyIntervals, requestFreeBusyToken } from "@/lib/google-calendar";
import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Lock, MapPin, X } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";
import { usePersonProfile, initials } from "@/components/person-profile-provider";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { SlotCardsSkeleton } from "@/components/skeletons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

const HOURS = Array.from({ length: 17 }, (_, i) => i + 7); // 7am–12am (last slot 11pm–midnight)
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Formal coffee-chat availability requirements (replaces the old, informal
// "30 hrs total" indicator):
//  - any day a host opens up needs at least this many bookable seats
//    (weighted by SEATS_PER_SUBSLOT, so e.g. 1×30min + 1×15min = 3+1 = 4)
const MIN_SEATS_PER_DAY = 4;
//  - hosts with fewer than this many booked chats in the current window
//    should keep Saturdays open (soft warning, not enforced on Save)
const SATURDAY_REQUIRED_BELOW = 10;
//  - once a host reaches this many booked chats, they may close out any
//    remaining unbooked availability
const MAY_CLOSE_AT = 20;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Availability is picked at sub-hour granularity: an hour is split into equal
// segments sized by the current brush duration (30m → 2 halves, 20m → 3
// thirds, 15m → 4 quarters, since all divide 60 evenly), and each painted
// segment becomes one real appointment sub-slot with its own seat count on
// Save. All selected segments within one hour share a single duration (mixed
// durations would overlap in time), so an hour is always split exactly one
// way. Shorter appointments fit more (smaller) sessions into the same hour.
type Duration = 15 | 20 | 30;
const DURATIONS: Duration[] = [15, 20, 30];
// How many equal segments an hour is split into for each duration (60 / dur).
const DIVISION: Record<Duration, number> = { 15: 4, 20: 3, 30: 2 };
const SEATS_PER_SUBSLOT: Record<Duration, number> = { 15: 1, 20: 2, 30: 3 };
// Fill color for an open (bookable) segment, by the duration its hour is split
// into — the bright, prominent palette.
const DURATION_COLOR: Record<Duration, string> = {
  30: "bg-green-400",
  20: "bg-amber-300",
  15: "bg-blue-300",
};
// Booked segments use a darker shade of the same hue (plus a lock icon), so
// they read as taken without competing with the open availability.
const BOOKED_COLOR: Record<Duration, string> = {
  30: "bg-green-700",
  20: "bg-amber-600",
  15: "bg-blue-600",
};

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

// Hour key for the grid: the top of the hour, as an ISO string.
function slotKey(date: Date, hour: number): string {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

// Exact sub-slot key == the DB meeting_time for a segment starting at
// `offsetMin` past the hour. subKey(date, hour, 0) === slotKey(date, hour).
function subKey(date: Date, hour: number, offsetMin: number): string {
  const d = new Date(date);
  d.setHours(hour, offsetMin, 0, 0);
  return d.toISOString();
}

// Which hour tile a raw DB meeting_time (possibly offset into a sub-slot)
// belongs to — the inverse of slotKey's hour-truncation.
function hourKeyOf(meetingTimeIso: string): string {
  const d = new Date(meetingTimeIso);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

type UpcomingSlot = {
  meeting_time: string;
  duration_minutes: number;
  capacity: number;
  filled: number;
  location: string | null;
  attendees: { id: string; name: string; user_id: string; email: string | null; avatarUrl: string | null; complete: boolean; message: string | null }[];
};

// Hover tooltip listing every booked sub-slot inside an hour cell.
function SlotTooltip({ infos, defaultLocation }: { infos: UpcomingSlot[]; defaultLocation: string }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-max max-w-[14rem] -translate-x-1/2 flex-col gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-background shadow-lg group-hover:flex">
      {infos.map((info) => {
        const loc = info.location ?? (defaultLocation.trim() || null);
        return (
          <div key={info.meeting_time} className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold tabular-nums">
              {new Date(info.meeting_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              {" · "}
              {info.filled}/{info.capacity}
            </span>
            {info.attendees.length > 0 ? (
              <span className="text-[11px] leading-snug opacity-90">
                {info.attendees.map((a) => a.name).join(", ")}
              </span>
            ) : (
              <span className="text-[11px] italic opacity-70">No attendees yet</span>
            )}
            {loc && (
              <span className="flex items-center gap-1 text-[11px] leading-snug opacity-90">
                <MapPin size={9} className="flex-shrink-0" />
                <span className="truncate max-w-[10rem]">{loc}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ManagerCoffeeChatsPage() {
  const { canSimulate, persona } = useRoleSim();
  const canEditWindow = canSimulate && persona === "exec";

  const [upcomingSlots, setUpcomingSlots] = useState<UpcomingSlot[]>([]);
  // Booked slots whose time has already passed. Kept separate from
  // upcomingSlots so the "Upcoming" list stays upcoming-only, but still shown
  // (grayed out) in a "Past" section below, and folded back in for the grid's
  // hover tooltips so a past booking's attendees stay visible.
  const [pastSlots, setPastSlots] = useState<UpcomingSlot[]>([]);
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
  // Which unbooked sub-slot segments are on, keyed by exact meeting_time ISO,
  // valued by the duration their hour is split into. All segments in one hour
  // share a duration. Pre-populated from the DB by load().
  const [selected, setSelected] = useState<Map<string, Duration>>(new Map());
  // Snapshot of the unbooked sub-slots currently persisted, for change diffing.
  const [dbSlots, setDbSlots] = useState<Map<string, Duration>>(new Map());
  // Sub-slots (exact meeting_time) that have at least one booked seat. These
  // stay OUT of `selected`/`dbSlots` so they're never re-split or range-deleted;
  // each locks only itself, not its whole hour — other sub-slots in the same
  // hour stay editable at the hour's (now frozen) duration.
  const [bookedSubSlots, setBookedSubSlots] = useState<Map<string, Duration>>(new Map());
  const [saving, setSaving] = useState(false);
  // Total coffee chats booked with this host in the current window (every row
  // with an applicant, not just upcoming ones) — drives the Saturday/close
  // warnings below.
  const [bookedCount, setBookedCount] = useState(0);
  const { openProfile } = usePersonProfile();

  // Host default meeting location / link, applied to newly-saved availability.
  const [defaultLocation, setDefaultLocation] = useState("");
  const [draftDefaultLocation, setDraftDefaultLocation] = useState("");
  const [savingDefaultLocation, setSavingDefaultLocation] = useState(false);

  // Destructive-action + editor dialogs.
  const [clearOpen, setClearOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string; meeting_time: string } | null>(null);
  const [cancelMessage, setCancelMessage] = useState("");
  const [locationTarget, setLocationTarget] = useState<{ meeting_time: string; attendeeIds: string[]; hadLocation: boolean } | null>(null);
  const [locationDraft, setLocationDraft] = useState("");

  // The duration "pen" — applied to any newly painted tile (drag, click, or
  // Google Calendar sync). Changing the brush never retags already-placed
  // tiles; those are retagged individually via their corner badge.
  const [brushDuration, setBrushDuration] = useState<Duration>(30);

  // Google Calendar free/busy auto-fill.
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  // Drag-to-select: hold and drag across segments to paint (or clear) a
  // rectangle of availability at once. `di` is the day index into weekDates;
  // `fi` is a fine segment index `hi * DIVISION[brush] + si` so a rectangle
  // spans hours continuously. `mode` is decided by the anchor segment's state.
  const [dragState, setDragState] = useState<{ anchor: { di: number; fi: number }; mode: "select" | "deselect" } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ di: number; fi: number } | null>(null);

  // Segments per hour for the current brush; a drag fixes its division to this.
  const div = DIVISION[brushDuration];

  // Roll the selected segments up per hour: hourKey -> { duration, offsets }.
  // Every segment in an hour shares one duration (enforced on paint), so the
  // hour's split is well-defined. Used for rendering, diffing, and saving.
  const fillsByHour = new Map<string, { duration: Duration; offsets: Set<number> }>();
  for (const [k, dur] of selected) {
    const hk = hourKeyOf(k);
    const f = fillsByHour.get(hk) ?? { duration: dur, offsets: new Set<number>() };
    f.offsets.add(new Date(k).getMinutes());
    fillsByHour.set(hk, f);
  }

  // Booking-derived locks. Once any sub-slot in an hour is booked, that hour's
  // duration/division is frozen (can't re-split); the specific booked offsets
  // render locked while the hour's other sub-slots stay editable at that
  // duration. Both maps are keyed by hour.
  const lockedDivByHour = new Map<string, Duration>();
  const bookedOffsetsByHour = new Map<string, Set<number>>();
  for (const [k, dur] of bookedSubSlots) {
    const hk = hourKeyOf(k);
    lockedDivByHour.set(hk, dur);
    const set = bookedOffsetsByHour.get(hk) ?? new Set<number>();
    set.add(new Date(k).getMinutes());
    bookedOffsetsByHour.set(hk, set);
  }

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


  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Host default meeting location (applied to newly-saved availability).
    const { data: me } = await supabase
      .from("members")
      .select("default_chat_location")
      .eq("user_id", user.id)
      .maybeSingle();
    setDefaultLocation(me?.default_chat_location ?? "");
    setDraftDefaultLocation(me?.default_chat_location ?? "");

    // Each hour tile is stored as one or more sub-slot timestamps, each with
    // its own seat rows, so a full window easily exceeds Supabase's 1000-row
    // response cap. Page through with .range() until a short page so no
    // slots are silently dropped. meeting_time isn't unique across seats, so
    // add id as a stable tiebreaker to keep paging deterministic.
    const PAGE_SIZE = 1000;
    const rows: { id: string; meeting_time: string; applicant_id: string | null; complete: boolean; duration_minutes: number; location: string | null; message: string | null }[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page } = await supabase
        .from("coffee_chats")
        .select("id, meeting_time, applicant_id, complete, duration_minutes, location, message")
        .eq("member_id", user.id)
        .gte("meeting_time", rangeStart.toISOString())
        .lt("meeting_time", addDays(rangeEnd, 1).toISOString())
        .order("meeting_time", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (!page?.length) break;
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    // Every row with an applicant is one booked coffee chat with this host,
    // regardless of whether it's past or upcoming.
    setBookedCount(rows.filter((r) => r.applicant_id !== null).length);

    if (!rows.length) {
      setUpcomingSlots([]);
      setPastSlots([]);
      setDbSlots(new Map());
      setBookedSubSlots(new Map());
      setSelected(new Map());
      setLoading(false);
      return;
    }

    // Build upcoming slots grouped by the exact sub-slot meeting_time.
    const grouped = new Map<string, { id: string; applicant_id: string | null; complete: boolean; message: string | null }[]>();
    const exactDuration = new Map<string, number>();
    const exactLocation = new Map<string, string | null>();
    for (const row of rows) {
      if (!grouped.has(row.meeting_time)) grouped.set(row.meeting_time, []);
      grouped.get(row.meeting_time)!.push({ id: row.id, applicant_id: row.applicant_id, complete: row.complete, message: row.message });
      if (!exactDuration.has(row.meeting_time)) exactDuration.set(row.meeting_time, row.duration_minutes);
      if (row.location) exactLocation.set(row.meeting_time, row.location);
    }

    const applicantIds = [...new Set(rows.map((r) => r.applicant_id).filter((id): id is string => id !== null))];
    const nameMap = new Map<string, string>();
    const emailMap = new Map<string, string | null>();
    const avatarMap = new Map<string, string | null>();
    if (applicantIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("user_id, preferred_firstname, lastname, email, avatar_url")
        .in("user_id", applicantIds);
      for (const m of members ?? []) {
        nameMap.set(m.user_id, [m.preferred_firstname, m.lastname].filter(Boolean).join(" ") || "Unknown");
        emailMap.set(m.user_id, m.email ?? null);
        avatarMap.set(m.user_id, m.avatar_url ?? null);
      }
    }

    const nowMs = Date.now();
    const upcoming: UpcomingSlot[] = [];
    const past: UpcomingSlot[] = [];
    for (const [meeting_time, entries] of grouped) {
      const filled = entries.filter((e): e is { id: string; applicant_id: string; complete: boolean; message: string | null } => e.applicant_id !== null);
      const slot: UpcomingSlot = {
        meeting_time,
        duration_minutes: exactDuration.get(meeting_time) ?? 30,
        capacity: entries.length,
        filled: filled.length,
        location: exactLocation.get(meeting_time) ?? null,
        attendees: filled.map((e) => ({
          id: e.id,
          user_id: e.applicant_id,
          name: nameMap.get(e.applicant_id) ?? "Unknown",
          email: emailMap.get(e.applicant_id) ?? null,
          avatarUrl: avatarMap.get(e.applicant_id) ?? null,
          complete: e.complete,
          message: e.message,
        })),
      };
      // Past meetings stay visible in the grid and fold into the "Past"
      // list below, but drop off the "Upcoming" list.
      (new Date(meeting_time).getTime() < nowMs ? past : upcoming).push(slot);
    }
    setUpcomingSlots(upcoming);
    setPastSlots(past);

    // Pre-populate the grid at sub-slot granularity. Pass 1: any sub-slot
    // (exact meeting_time) with a booked seat is locked — but only itself, not
    // its whole hour. Pass 2: every unbooked sub-slot that is NOT part of a
    // booked sub-slot becomes an editable segment keyed by its meeting_time;
    // unbooked sub-slots in an hour that also contains a booking are included
    // too (they share that hour's frozen duration).
    // Normalize meeting_time to the canonical ISO (…Z) form that subKey()
    // produces, so drag/toggle key lookups match the loaded keys. (Postgres
    // returns timestamptz as e.g. …+00:00, which is a different string.)
    const norm = (iso: string) => new Date(iso).toISOString();
    const booked = new Map<string, Duration>();
    for (const row of rows) {
      if (row.applicant_id !== null) booked.set(norm(row.meeting_time), row.duration_minutes as Duration);
    }
    const dbMap = new Map<string, Duration>();
    for (const row of rows) {
      if (row.applicant_id !== null) continue;
      if (booked.has(norm(row.meeting_time))) continue; // open companion seat of a booked sub-slot: locked with it
      dbMap.set(norm(row.meeting_time), row.duration_minutes as Duration);
    }
    setDbSlots(dbMap);
    setBookedSubSlots(booked);
    setSelected(new Map(dbMap));
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

  // An hour's availability can be edited if it's inside the window and not in
  // the past. A booking no longer locks the whole hour — it only locks its own
  // sub-slot (see bookedSubSlots / lockedDivByHour).
  const isEditable = (date: Date, hour: number) =>
    inRange(date) && !isPast(date, hour);

  // Toggle a single sub-slot on/off. Used to edit the open sub-slots of a
  // partially-booked (frozen-duration) hour by clicking, independent of the
  // current brush — the brush drag skips those hours.
  const toggleSubSlot = (date: Date, hour: number, offsetMin: number, duration: Duration) => {
    if (!isEditable(date, hour)) return;
    const key = subKey(date, hour, offsetMin);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, duration);
      return next;
    });
  };

  // Begin a drag from a segment. `bi` is the brush-segment index the pointer is
  // over. The anchor's current state picks the mode: start on an empty segment
  // to add, on a filled one to clear. A plain click is a 1×1 drag, committed on
  // pointer-up below.
  const startDrag = (di: number, hi: number, bi: number, date: Date, hour: number) => {
    if (!isEditable(date, hour)) return;
    const key = subKey(date, hour, bi * brushDuration);
    setDragState({ anchor: { di, fi: hi * div + bi }, mode: selected.has(key) ? "deselect" : "select" });
    setDragCurrent({ di, fi: hi * div + bi });
  };

  // Commit the drawn rectangle on pointer-up (listener on window so releasing
  // outside the grid still finishes the drag). Segments toggle individually:
  // painting into an empty or same-division hour just adds/removes the covered
  // segments, leaving siblings intact. Only a foreign-division hour (its split
  // differs from the current brush) is re-split, since its segments can't align.
  useEffect(() => {
    if (!dragState) return;
    const commit = () => {
      setSelected((prev) => {
        if (!dragCurrent) return prev;
        const d0 = Math.min(dragState.anchor.di, dragCurrent.di);
        const d1 = Math.max(dragState.anchor.di, dragCurrent.di);
        const f0 = Math.min(dragState.anchor.fi, dragCurrent.fi);
        const f1 = Math.max(dragState.anchor.fi, dragCurrent.fi);
        const next = new Map(prev);
        for (let di = d0; di <= d1; di++) {
          const date = weekDates[di];
          // Group the covered fine-indices into the hours they fall in.
          const coveredByHi = new Map<number, number[]>();
          for (let fi = f0; fi <= f1; fi++) {
            const hi = Math.floor(fi / div);
            if (!coveredByHi.has(hi)) coveredByHi.set(hi, []);
            coveredByHi.get(hi)!.push(fi - hi * div);
          }
          for (const [hi, coveredSi] of coveredByHi) {
            const hour = HOURS[hi];
            if (hour === undefined || !isEditable(date, hour)) continue;
            const hk = slotKey(date, hour);
            // Hours that contain a booking keep a frozen duration and are edited
            // by clicking their individual sub-slots (toggleSubSlot), not by the
            // brush drag — skip them here so the drag never re-splits them.
            if (lockedDivByHour.has(hk)) continue;
            const curDur = fillsByHour.get(hk)?.duration;
            const foreign = curDur !== undefined && curDur !== brushDuration;
            if (dragState.mode === "select") {
              // Re-split only when converting a foreign-division hour; otherwise
              // just add the covered segments alongside the existing ones.
              if (foreign) for (const key of [...next.keys()]) if (hourKeyOf(key) === hk) next.delete(key);
              for (const si of coveredSi) next.set(subKey(date, hour, si * brushDuration), brushDuration);
            } else if (foreign) {
              // Foreign-division erase can't align to the brush; clear the hour.
              for (const key of [...next.keys()]) if (hourKeyOf(key) === hk) next.delete(key);
            } else {
              for (const si of coveredSi) next.delete(subKey(date, hour, si * brushDuration));
            }
          }
        }
        return next;
      });
      setDragState(null);
      setDragCurrent(null);
    };
    window.addEventListener("pointerup", commit);
    return () => window.removeEventListener("pointerup", commit);
  }, [dragState, dragCurrent, weekDates, bookedSubSlots, lockedDivByHour, brushDuration, div, fillsByHour]);

  // Tooltip data: every sub-slot (past or upcoming), grouped by the hour tile
  // it falls inside (one hour tile can now contain several real sub-slot
  // times) — includes past slots so a past booking still shows its attendees
  // on hover in the grid, instead of going silent once it's passed.
  const tileSlotInfos = new Map<string, UpcomingSlot[]>();
  for (const s of [...upcomingSlots, ...pastSlots]) {
    const tk = hourKeyOf(s.meeting_time);
    if (!tileSlotInfos.has(tk)) tileSlotInfos.set(tk, []);
    tileSlotInfos.get(tk)!.push(s);
  }

  // Past booked slots, most recent first, for the "Past" list below Upcoming.
  const bookedPast = pastSlots.filter((s) => s.filled > 0).sort((a, b) => b.meeting_time.localeCompare(a.meeting_time));

  // The Upcoming list only surfaces slots someone has actually booked; empty
  // availability still lives in the grid above, so hiding it here just removes
  // the noise of every open hour.
  const bookedUpcoming = upcomingSlots.filter((s) => s.filled > 0);

  // Total seats offered (booked + open) per local calendar day across the
  // whole window — a sub-slot's seat count is fixed by its duration
  // (SEATS_PER_SUBSLOT) regardless of how many of those seats are booked, so
  // booked and open sub-slots are weighted the same way here. Drives the
  // per-day minimum-seats badge in the grid header.
  const seatsByDate = new Map<string, number>();
  for (const [k, dur] of selected) {
    const ds = toDateInputValue(new Date(k));
    seatsByDate.set(ds, (seatsByDate.get(ds) ?? 0) + SEATS_PER_SUBSLOT[dur]);
  }
  for (const [k, dur] of bookedSubSlots) {
    const ds = toDateInputValue(new Date(k));
    seatsByDate.set(ds, (seatsByDate.get(ds) ?? 0) + SEATS_PER_SUBSLOT[dur]);
  }

  // Normalized bounds of the in-progress drag rectangle (day range × fine
  // segment range), used to preview which segments the drag would affect.
  const dragRect = dragState && dragCurrent
    ? {
        d0: Math.min(dragState.anchor.di, dragCurrent.di),
        d1: Math.max(dragState.anchor.di, dragCurrent.di),
        f0: Math.min(dragState.anchor.fi, dragCurrent.fi),
        f1: Math.max(dragState.anchor.fi, dragCurrent.fi),
      }
    : null;

  // Per-hour signature ("dur:off,off,…") so a change in duration or in which
  // segments are filled counts, keyed by hour. Compares `selected` vs `dbSlots`.
  const hourSignatures = (m: Map<string, Duration>) => {
    const g = new Map<string, { duration: Duration; offsets: number[] }>();
    for (const [k, d] of m) {
      const hk = hourKeyOf(k);
      const e = g.get(hk) ?? { duration: d, offsets: [] };
      e.offsets.push(new Date(k).getMinutes());
      g.set(hk, e);
    }
    const sig = new Map<string, string>();
    for (const [hk, e] of g) sig.set(hk, `${e.duration}:${e.offsets.sort((a, b) => a - b).join(",")}`);
    return sig;
  };

  // Hours whose persisted layout differs from the working set (either side).
  const dirtyHours = (): Set<string> => {
    const cur = hourSignatures(selected);
    const db = hourSignatures(dbSlots);
    const dirty = new Set<string>();
    for (const [hk, s] of cur) if (db.get(hk) !== s) dirty.add(hk);
    for (const [hk, s] of db) if (cur.get(hk) !== s) dirty.add(hk);
    return dirty;
  };

  const hasChanges = dirtyHours().size > 0;

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const dirty = dirtyHours();

    // Range-delete every unbooked row within an hour (used only for "clean"
    // hours with no bookings — a partially-booked hour is diffed per sub-slot
    // instead so booked seats and their open companions survive).
    const deleteHour = (hourKeyIso: string) => {
      const start = new Date(hourKeyIso);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return supabase
        .from("coffee_chats")
        .delete()
        .eq("member_id", user.id)
        .gte("meeting_time", start.toISOString())
        .lt("meeting_time", end.toISOString())
        .is("applicant_id", null);
    };

    // One row per seat for a single sub-slot offset.
    const buildRows = (hourKeyIso: string, duration: Duration, offsets: number[]) => {
      const start = new Date(hourKeyIso);
      const seats = SEATS_PER_SUBSLOT[duration];
      return offsets.flatMap((offsetMin) => {
        const d = new Date(start);
        d.setMinutes(offsetMin, 0, 0);
        const meeting_time = d.toISOString();
        // location stays unset: open slots resolve against the host's live
        // default_chat_location at display/booking time instead of freezing
        // whatever the default was when the slot happened to be painted.
        return Array.from({ length: seats }, () => ({
          member_id: user.id,
          meeting_time,
          applicant_id: null,
          complete: false,
          duration_minutes: duration,
        }));
      });
    };

    // Delete the open seats of a single sub-slot (leaves any booked seat).
    const removeSubSlot = (meetingTimeIso: string) =>
      supabase.from("coffee_chats").delete()
        .eq("member_id", user.id).eq("meeting_time", meetingTimeIso).is("applicant_id", null);

    const rowsToInsert: Record<string, unknown>[] = [];
    for (const hk of dirty) {
      if (lockedDivByHour.has(hk)) {
        // Partially-booked hour: diff unbooked offsets at the frozen duration.
        // Never range-delete (would wipe booked seats' open companions).
        const D = lockedDivByHour.get(hk)!;
        const desired = fillsByHour.get(hk)?.offsets ?? new Set<number>();
        const current = new Set<number>();
        for (const k of dbSlots.keys()) if (hourKeyOf(k) === hk) current.add(new Date(k).getMinutes());
        const subSlotIso = (off: number) => {
          const d = new Date(hk);
          d.setMinutes(off, 0, 0);
          return d.toISOString();
        };
        for (const off of desired) if (!current.has(off)) rowsToInsert.push(...buildRows(hk, D, [off]));
        for (const off of current) if (!desired.has(off)) await removeSubSlot(subSlotIso(off));
      } else {
        // Clean hour: wipe and rebuild from the current segments.
        await deleteHour(hk);
        const f = fillsByHour.get(hk);
        if (f) rowsToInsert.push(...buildRows(hk, f.duration, [...f.offsets]));
      }
    }
    if (rowsToInsert.length > 0) {
      await supabase.from("coffee_chats").insert(rowsToInsert);
    }

    // Re-fetch so the grid and upcoming list reflect the saved state.
    await load();
    setSaving(false);
  };

  const toggleComplete = async (rowId: string, meetingTime: string, next: boolean) => {
    const supabase = createClient();
    const { error } = await supabase.from("coffee_chats").update({ complete: next }).eq("id", rowId);
    if (error) return;
    const patch = (prev: UpcomingSlot[]) =>
      prev.map((slot) =>
        slot.meeting_time !== meetingTime
          ? slot
          : { ...slot, attendees: slot.attendees.map((a) => (a.id === rowId ? { ...a, complete: next } : a)) },
      );
    setUpcomingSlots(patch);
    setPastSlots(patch);
  };

  // Pull the manager's Google Calendar free/busy across the whole window and
  // auto-fill every editable, currently-empty hour that has no overlapping
  // event, splitting each into the current brush's segments. This only
  // paints the grid — the member reviews and clicks Save to persist. The
  // overlap check stays a conservative full hour regardless of the tagged
  // duration: a shorter appointment still needs a genuinely free hour to
  // land in, and the manager reviews/adjusts before saving anyway.
  const handleSync = async () => {
    setSyncError(null);
    setSyncSummary(null);
    setSyncing(true);
    try {
      const token = await requestFreeBusyToken();
      const busy = await fetchBusyIntervals(token, rangeStart, rangeEndExclusive);

      let added = 0;
      setSelected((prev) => {
        const next = new Map(prev);
        for (let date = new Date(rangeStart); date < rangeEndExclusive; date = addDays(date, 1)) {
          for (const hour of HOURS) {
            const hk = slotKey(date, hour);
            // Skip out-of-range/past hours, hours already painted, and any hour
            // that contains a booking (its division is frozen).
            const alreadyFilled = [...next.keys()].some((k) => hourKeyOf(k) === hk);
            if (!isEditable(date, hour) || alreadyFilled || lockedDivByHour.has(hk)) continue;
            const slotStart = new Date(date);
            slotStart.setHours(hour, 0, 0, 0);
            const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
            const overlaps = busy.some((b) => b.start < slotEnd && b.end > slotStart);
            if (!overlaps) {
              for (let si = 0; si < div; si++) next.set(subKey(date, hour, si * brushDuration), brushDuration);
              added++;
            }
          }
        }
        return next;
      });

      setSyncSummary(
        added > 0
          ? `Added ${added} free ${added === 1 ? "slot" : "slots"} from your calendar. Review and Save.`
          : "No new free slots found in this window.",
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Couldn't sync with Google Calendar.");
    } finally {
      setSyncing(false);
    }
  };

  // Clear every open (unbooked) availability slot in the whole window. Booked
  // sub-slots are left untouched.
  const clearAvailability = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase
      .from("coffee_chats")
      .delete()
      .eq("member_id", user.id)
      .is("applicant_id", null)
      .gte("meeting_time", rangeStart.toISOString())
      .lt("meeting_time", rangeEndExclusive.toISOString());
    if (error) return false;
    await load();
  };

  // Host cancels one booking: notify the applicant first (the row still binds
  // both parties), then release the seat.
  const cancelBooking = async () => {
    if (!cancelTarget) return false;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    await supabase.rpc("notify_coffee_chat_counterparty", {
      p_chat_id: cancelTarget.id,
      p_type: "chat_cancelled_by_host",
      p_message: cancelMessage.trim() || null,
    });
    const { error } = await supabase
      .from("coffee_chats")
      .update({ applicant_id: null })
      .eq("id", cancelTarget.id)
      .eq("member_id", user.id);
    if (error) return false;
    setCancelMessage("");
    await load();
  };

  // Set / update the meeting location for one booked sub-slot (all its seats),
  // then notify each attendee.
  const saveSlotLocation = async () => {
    if (!locationTarget) return false;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const value = locationDraft.trim() || null;
    const { error } = await supabase
      .from("coffee_chats")
      .update({ location: value })
      .eq("member_id", user.id)
      .eq("meeting_time", locationTarget.meeting_time);
    if (error) return false;
    if (value) {
      const type = locationTarget.hadLocation ? "location_updated" : "location_added";
      for (const id of locationTarget.attendeeIds) {
        await supabase.rpc("notify_coffee_chat_counterparty", { p_chat_id: id, p_type: type });
      }
    }
    await load();
  };

  const saveDefaultLocation = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setSavingDefaultLocation(true);
    const value = draftDefaultLocation.trim() || null;
    // Sets the host default AND propagates it to existing upcoming booked chats
    // that have no location or still match the old default (custom per-slot
    // locations are preserved), notifying affected attendees. See migration
    // 0036_apply_default_chat_location.sql.
    await supabase.rpc("set_default_chat_location", { p_location: value });
    setDefaultLocation(value ?? "");
    setSavingDefaultLocation(false);
    // Reload so booked-slot cards reflect the rewritten locations.
    await load();
  };

  const defaultLocationDirty = draftDefaultLocation.trim() !== defaultLocation.trim();

  // Shared card for both the Upcoming and Past lists. Past slots gray out and
  // drop location-editing / cancel (nothing to prep or cancel after the
  // fact) — but keep the complete toggle, so attendance can still be recorded.
  const renderBookedSlot = (slot: UpcomingSlot, isPast: boolean) => {
    const d = new Date(slot.meeting_time);
    const resolvedLocation = slot.location || defaultLocation.trim() || null;
    return (
      <div key={slot.meeting_time} className={`border rounded-xl p-4 flex flex-col gap-2 ${isPast ? "opacity-50" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </p>
            <p className="text-xs text-muted-foreground">
              {d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              {" · "}
              {slot.duration_minutes} min
            </p>
          </div>
          <span className={`text-sm font-semibold tabular-nums ${slot.filled === slot.capacity ? "text-red-500" : "text-green-600"}`}>
            {slot.filled}/{slot.capacity}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <MapPin size={12} className="text-muted-foreground flex-shrink-0" />
          <span className={`truncate ${resolvedLocation ? "text-foreground" : "text-muted-foreground italic"}`}>
            {resolvedLocation || "No location set"}
          </span>
          {!isPast && (
            <button
              type="button"
              onClick={() => {
                setLocationTarget({
                  meeting_time: slot.meeting_time,
                  attendeeIds: slot.attendees.map((a) => a.id),
                  hadLocation: !!slot.location,
                });
                setLocationDraft(slot.location ?? defaultLocation);
              }}
              className="text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2"
            >
              {slot.location ? "Edit" : "Add"}
            </button>
          )}
        </div>
        {slot.attendees.length > 0 ? (
          <>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {slot.attendees.map((a) => (
              <div
                key={a.user_id}
                className="flex items-center gap-1 pl-1 pr-1 py-0.5 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors"
              >
                <button
                  type="button"
                  onClick={() =>
                    openProfile({ userId: a.user_id, name: a.name, preloaded: { email: a.email, avatar_url: a.avatarUrl } })
                  }
                  title={a.email ?? undefined}
                  className="group relative flex items-center gap-1.5 text-xs font-medium"
                >
                  {a.avatarUrl ? (
                    <img src={a.avatarUrl} alt={a.name} className="h-5 w-5 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/15 text-[9px] font-semibold flex-shrink-0">
                      {initials(a.name)}
                    </span>
                  )}
                  {a.name}
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-max max-w-[16rem] -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] text-background shadow-lg group-hover:block">
                    {a.email ?? "No email on file"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleComplete(a.id, slot.meeting_time, !a.complete)}
                  title={a.complete ? "Mark as not complete" : "Mark complete"}
                  className={`flex items-center justify-center w-4 h-4 rounded-full transition-colors ${
                    a.complete
                      ? "bg-green-500 text-white"
                      : "border border-foreground/30 text-transparent hover:border-foreground/60"
                  }`}
                >
                  <Check size={10} />
                </button>
                {!isPast && (
                  <button
                    type="button"
                    onClick={() => { setCancelTarget({ id: a.id, name: a.name, meeting_time: slot.meeting_time }); setCancelMessage(""); }}
                    title="Cancel this booking"
                    className="flex items-center justify-center w-4 h-4 rounded-full text-red-500 hover:bg-red-500/15 transition-colors"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {slot.attendees.some((a) => a.message) && (
            <div className="flex flex-col gap-1 pt-1.5">
              {slot.attendees.filter((a) => a.message).map((a) => (
                <p key={a.user_id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{a.name}:</span>{" "}
                  <span className="italic">&ldquo;{a.message}&rdquo;</span>
                </p>
              ))}
            </div>
          )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No attendees yet.</p>
        )}
      </div>
    );
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-10">
      {GOOGLE_CLIENT_ID && (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      )}
      <div className="flex flex-col gap-1">
        <Link href="/manager" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
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
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your Availability</h2>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium tabular-nums">
              {bookedCount} coffee chat{bookedCount === 1 ? "" : "s"} booked this window
            </span>
            {bookedCount < SATURDAY_REQUIRED_BELOW && (
              <span className="text-xs text-amber-500">
                Under {SATURDAY_REQUIRED_BELOW} booked — keep Saturdays open
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {bookedCount >= MAY_CLOSE_AT && (
              <button
                onClick={() => setClearOpen(true)}
                disabled={saving || (selected.size === 0 && dbSlots.size === 0)}
                className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-30"
              >
                Close remaining availability
              </button>
            )}
            {GOOGLE_CLIENT_ID && (
              <button
                onClick={handleSync}
                disabled={syncing || !settingsReady}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-30"
              >
                <CalendarCheck size={14} />
                {syncing ? "Syncing…" : "Sync with Google Calendar"}
              </button>
            )}
            <button
              onClick={() => setClearOpen(true)}
              disabled={saving || (selected.size === 0 && dbSlots.size === 0)}
              className="rounded-md border border-red-500/40 text-red-500 px-3 py-1.5 text-xs font-medium hover:bg-red-500/10 transition-colors disabled:opacity-30"
            >
              Clear all
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-30"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Duration brush — sets the length tagged onto newly painted tiles */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">New slots:</span>
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setBrushDuration(d)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  brushDuration === d ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {d}m
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            (drag on the grid to paint {brushDuration}-minute segments)
          </span>
        </div>

        {/* Default meeting location / link — inherited by newly-saved slots */}
        <div className="flex items-center gap-2 flex-wrap">
          <MapPin size={14} className="text-muted-foreground" />
          <input
            type="text"
            value={draftDefaultLocation}
            onChange={(e) => setDraftDefaultLocation(e.target.value)}
            placeholder="Default location or meeting link (e.g. Zoom URL)"
            className="flex-1 min-w-[16rem] border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={saveDefaultLocation}
            disabled={savingDefaultLocation || !defaultLocationDirty}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-30"
          >
            {savingDefaultLocation ? "Saving…" : "Save default"}
          </button>
        </div>

        {syncError && <p className="text-sm text-red-500">{syncError}</p>}
        {syncSummary && <p className="text-sm text-green-600">{syncSummary}</p>}

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
        <ScrollArea orientation="horizontal">
          <div className="min-w-[560px] select-none">
            {/* Day headers */}
            <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-1 mb-1">
              <div />
              {weekDates.map((date, i) => {
                const seats = seatsByDate.get(toDateInputValue(date)) ?? 0;
                const belowMin = seats > 0 && seats < MIN_SEATS_PER_DAY;
                return (
                  <div key={i} className={`text-center transition-opacity ${inRange(date) ? "" : "opacity-30"}`}>
                    <p className="text-xs text-muted-foreground">{DAY_LABELS[i]}</p>
                    <p className={`text-sm font-semibold ${date.toDateString() === now.toDateString() ? "text-blue-500" : ""}`}>
                      {date.getDate()}
                    </p>
                    {inRange(date) && seats > 0 && (
                      <p className={`text-[10px] tabular-nums ${belowMin ? "text-amber-500" : "text-green-600"}`}>
                        {seats}/{MIN_SEATS_PER_DAY} seats
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Hour rows — no vertical gap, so each day reads as one strip */}
            <div className="flex flex-col">
              {HOURS.map((hour, hi) => {
                const firstHour = hi === 0;
                const lastHour = hi === HOURS.length - 1;
                return (
                <div key={hour} className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-1">
                  <div className="flex items-start justify-end pr-2">
                    <span className="text-xs text-muted-foreground leading-none -translate-y-1/2">{formatHour(hour)}</span>
                  </div>
                  {weekDates.map((date, di) => {
                    const hk = slotKey(date, hour);
                    const outOfRange = !inRange(date);
                    const past = isPast(date, hour);
                    const bookedInfos = (tileSlotInfos.get(hk) ?? []).filter((i) => i.filled > 0);
                    // A booked sub-slot whose location was explicitly set to
                    // something other than the current default — flagged so a
                    // PM/exec scanning the grid can spot exceptions at a glance.
                    const hasLocationOverride = bookedInfos.some(
                      (i) => i.location && i.location !== (defaultLocation.trim() || null),
                    );
                    const fill = fillsByHour.get(hk);
                    const lockedDur = lockedDivByHour.get(hk);
                    const bookedOffsets = bookedOffsetsByHour.get(hk);

                    // Continuous-column framing: full side borders, rounded only
                    // at the very top/bottom, hairline separators between hours.
                    const frame =
                      `border-x border-foreground/50 ${firstHour ? "border-t rounded-t-md" : ""} ` +
                      (lastHour ? "border-b rounded-b-md" : "border-b-2 border-b-foreground/30");

                    if (outOfRange) {
                      return (
                        <div key={di} className={`h-9 bg-foreground/5 opacity-10 ${frame}`} />
                      );
                    }

                    // A booked sub-slot freezes the hour's duration; otherwise
                    // the cell renders at its own fill split (or the brush split
                    // when empty). Each own-segment maps to the brush segment
                    // covering its start, so drag math (in brush space) works
                    // regardless of the cell's split.
                    const cellDur = lockedDur ?? (fill ? fill.duration : brushDuration);
                    const cellDiv = DIVISION[cellDur];
                    const foreign = fill !== undefined && fill.duration !== brushDuration;
                    // A booked hour keeps a frozen duration and is edited by
                    // clicking its open sub-slots — the brush drag skips it.
                    const hourLocked = lockedDur !== undefined;
                    const hourFineStart = hi * div;
                    const cellInDrag =
                      !!dragRect &&
                      di >= dragRect.d0 && di <= dragRect.d1 &&
                      dragRect.f0 <= hourFineStart + div - 1 && dragRect.f1 >= hourFineStart &&
                      isEditable(date, hour) && !past && !hourLocked;

                    return (
                      <div key={di} className="relative group">
                        <div className={`flex flex-col h-9 overflow-hidden ${past ? "opacity-40 cursor-not-allowed" : ""} ${frame}`}>
                          {Array.from({ length: cellDiv }, (_, si) => {
                            const offset = si * cellDur;
                            const locked = !!bookedOffsets?.has(offset);
                            if (locked) {
                              // Booked sub-slot: locked, non-interactive.
                              return (
                                <div
                                  key={si}
                                  className={`flex-1 flex items-center justify-center ${BOOKED_COLOR[cellDur]} text-white/85 cursor-not-allowed ${si ? "border-t border-t-white/20" : ""}`}
                                >
                                  <Lock size={10} />
                                </div>
                              );
                            }
                            const existing = !!fill && fill.offsets.has(offset);

                            // Open sub-slot inside a booked hour: click to toggle
                            // at the hour's frozen duration (no brush drag here).
                            if (hourLocked) {
                              return (
                                <div
                                  key={si}
                                  onClick={past ? undefined : () => toggleSubSlot(date, hour, offset, cellDur)}
                                  className={`flex-1 touch-none transition-colors ${si ? "border-t border-t-foreground/10" : ""} ${
                                    past ? "" : "cursor-pointer"
                                  } ${existing ? DURATION_COLOR[cellDur] : past ? "" : "hover:bg-accent"}`}
                                />
                              );
                            }

                            // Brush segment this own-segment's start falls in.
                            const bi = Math.floor(offset / brushDuration);
                            const segInDrag = cellInDrag && dragRect!.f0 <= hourFineStart + bi && dragRect!.f1 >= hourFineStart + bi;
                            let filled: boolean;
                            if (cellInDrag) {
                              if (dragState!.mode === "select") filled = foreign ? segInDrag : (segInDrag || existing);
                              else filled = foreign ? false : (existing && !segInDrag);
                            } else {
                              filled = existing;
                            }
                            const previewPaint = segInDrag && dragState!.mode === "select";
                            return (
                              <div
                                key={si}
                                onPointerDown={past ? undefined : (e) => { e.preventDefault(); startDrag(di, hi, bi, date, hour); }}
                                onPointerEnter={past ? undefined : () => { if (dragState) setDragCurrent({ di, fi: hi * div + bi }); }}
                                className={`flex-1 touch-none transition-colors ${si ? "border-t border-t-foreground/10" : ""} ${
                                  segInDrag ? "ring-1 ring-inset ring-blue-400 " : ""
                                }${filled ? (previewPaint ? DURATION_COLOR[brushDuration] : DURATION_COLOR[cellDur]) : past ? "" : "hover:bg-accent"}`}
                              />
                            );
                          })}
                        </div>
                        {hasLocationOverride && (
                          <span className="pointer-events-none absolute top-0 right-0 z-[1] flex items-center justify-center w-3 h-3 rounded-bl bg-foreground/80 text-background">
                            <MapPin size={7} />
                          </span>
                        )}
                        {bookedInfos.length > 0 && <SlotTooltip infos={bookedInfos} defaultLocation={defaultLocation} />}
                      </div>
                    );
                  })}
                </div>
                );
              })}
            </div>
          </div>
        </ScrollArea>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {DURATIONS.map((d) => (
            <span key={d} className="flex items-center gap-1.5">
              <span className={`inline-block w-3 h-3 rounded-sm ${DURATION_COLOR[d]}`} /> {d}-min slots
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-3 h-3 rounded-sm bg-green-700 text-white/85">
              <Lock size={8} />
            </span>{" "}
            Booked (darker + lock)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-3 h-3 rounded-sm bg-foreground/80 text-background">
              <MapPin size={8} />
            </span>{" "}
            Custom location (differs from default)
          </span>
        </div>
      </div>

      {/* Booked coffee chats — upcoming, then past (grayed out) below */}
      {loading ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</h2>
          <SlotCardsSkeleton />
        </div>
      ) : (
        <>
          {bookedUpcoming.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</h2>
              {bookedUpcoming.map((slot) => renderBookedSlot(slot, false))}
            </div>
          )}
          {bookedPast.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Past</h2>
              {bookedPast.map((slot) => renderBookedSlot(slot, true))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear all availability?"
        description="This removes every open slot you've offered across the whole window. Booked chats are kept. This can't be undone."
        confirmLabel="Clear availability"
        onConfirm={clearAvailability}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title="Cancel this booking?"
        description={cancelTarget
          ? `Cancel ${cancelTarget.name}'s coffee chat on ${new Date(cancelTarget.meeting_time).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}? They'll be notified and the slot frees up.`
          : ""}
        confirmLabel="Cancel booking"
        onConfirm={cancelBooking}
      >
        <textarea
          value={cancelMessage}
          onChange={(e) => setCancelMessage(e.target.value)}
          placeholder="Optional message to the applicant (e.g. a reason, or to suggest they rebook)…"
          rows={3}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={locationTarget !== null}
        onOpenChange={(o) => { if (!o) setLocationTarget(null); }}
        title="Meeting location"
        description="Set a location or meeting link for this chat. Attendees are notified and it shows on their booking."
        confirmLabel="Save location"
        destructive={false}
        onConfirm={saveSlotLocation}
      >
        <input
          type="text"
          value={locationDraft}
          onChange={(e) => setLocationDraft(e.target.value)}
          placeholder="e.g. https://zoom.us/j/… or Soda Hall 3rd floor"
          className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </ConfirmDialog>
    </div>
  );
}
