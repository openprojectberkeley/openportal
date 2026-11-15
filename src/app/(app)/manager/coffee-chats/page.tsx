"use client";

import { createClient } from "@/lib/supabase/client";
import { fetchBusyIntervals, requestFreeBusyToken } from "@/lib/google-calendar";
import Link from "next/link";
import Script from "next/script";
import { cloneElement, useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Lock, MapPin, MoreHorizontal, Settings, Trash2, X } from "lucide-react";
import { useRoleSim } from "@/components/role-simulation-provider";
import { usePersonProfile, initials } from "@/components/person-profile-provider";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { BookedChatsSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Disclosure } from "@/components/ui/disclosure";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { background, optimistic, sessionUserId } from "@/lib/optimistic";
import { toast } from "sonner";
import { Segmented } from "@/components/ui/segmented";
import { InfoHint } from "@/components/ui/info-hint";
import { BackLink } from "@/components/back-link";
import { toastSaved } from "@/lib/saved-toast";

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
// Fallback window used only until VP Tech/President configures one (or the app_settings
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
  attendees: { id: string; name: string; user_id: string; email: string | null; avatarUrl: string | null; complete: boolean; no_show: boolean; message: string | null }[];
};

// Hover tooltip listing every booked sub-slot inside an hour cell.
function SlotTooltip({ infos, defaultLocation }: { infos: UpcomingSlot[]; defaultLocation: string }) {
  return (
    <TooltipContent side="top" className="flex max-w-[14rem] flex-col gap-1.5">
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
    </TooltipContent>
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
  const { saved: availabilitySaved, flash: flashAvailabilitySaved } = useSaveFlash();
  // Total coffee chats booked with this host in the current window (every row
  // with an applicant, not just upcoming ones) — drives the Saturday/close
  // warnings below.
  const [bookedCount, setBookedCount] = useState(0);
  const { openProfile } = usePersonProfile();

  // Host default meeting location / link, applied to newly-saved availability.
  const [defaultLocation, setDefaultLocation] = useState("");
  const [draftDefaultLocation, setDraftDefaultLocation] = useState("");

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
    const rows: { id: string; meeting_time: string; applicant_id: string | null; complete: boolean; no_show: boolean; duration_minutes: number; location: string | null; message: string | null }[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page } = await supabase
        .from("coffee_chats")
        .select("id, meeting_time, applicant_id, complete, no_show, duration_minutes, location, message")
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
    const grouped = new Map<string, { id: string; applicant_id: string | null; complete: boolean; no_show: boolean; message: string | null }[]>();
    const exactDuration = new Map<string, number>();
    const exactLocation = new Map<string, string | null>();
    for (const row of rows) {
      if (!grouped.has(row.meeting_time)) grouped.set(row.meeting_time, []);
      grouped.get(row.meeting_time)!.push({ id: row.id, applicant_id: row.applicant_id, complete: row.complete, no_show: row.no_show, message: row.message });
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
      const filled = entries.filter((e): e is { id: string; applicant_id: string; complete: boolean; no_show: boolean; message: string | null } => e.applicant_id !== null);
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
          no_show: e.no_show,
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

    // The grid re-ranges at once; the setting is written behind it.
    const supabase = createClient();
    const prevStart = rangeStart;
    const prevEnd = rangeEnd;
    void optimistic({
      label: "coffee chat window",
      key: "coffee-window",
      apply: () => {
        setRangeStart(start);
        setRangeEnd(end);
        setWeekOffset((w) => Math.min(weekCountFor(start, end) - 1, Math.max(0, w)));
        toastSaved("Window saved");
      },
      rollback: () => {
        setRangeStart(prevStart);
        setRangeEnd(prevEnd);
        setWeekOffset((w) => Math.min(weekCountFor(prevStart, prevEnd) - 1, Math.max(0, w)));
      },
      commit: () =>
        supabase
          .from("app_settings")
          .upsert({ id: 1, coffee_chat_start: draftStart, coffee_chat_end: draftEnd, updated_at: new Date().toISOString() }),
      onFailed: (message) => setWindowError(message),
    });
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
    // Re-subscribes every render anyway (the derived maps are rebuilt each
    // render); the listener just needs the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Optimistic: the grid is marked saved the moment Save is clicked (dbSlots
  // takes the painted selection), and the deletes/inserts run behind it. Any
  // refused write reloads the real state from the server and toasts. `saving`
  // stays on meanwhile only to stop a second save racing the first.
  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const userId = await sessionUserId(supabase);
    if (!userId) { setSaving(false); return; }
    const user = { id: userId };

    // Diffed against the pre-save state captured in this closure.
    const dirty = dirtyHours();
    setDbSlots(new Map(selected));
    const failures: string[] = [];
    const track = async (q: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await q;
      if (error) failures.push(error.message);
    };

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
        for (const off of current) if (!desired.has(off)) await track(removeSubSlot(subSlotIso(off)));
      } else {
        // Clean hour: wipe and rebuild from the current segments.
        await track(deleteHour(hk));
        const f = fillsByHour.get(hk);
        if (f) rowsToInsert.push(...buildRows(hk, f.duration, [...f.offsets]));
      }
    }
    if (rowsToInsert.length > 0) {
      await track(supabase.from("coffee_chats").insert(rowsToInsert));
    }

    if (failures.length) {
      toast.error("Couldn't save availability", {
        description: "Some slots didn't save; the grid now shows what's actually saved.",
      });
    } else {
      // Confirm as soon as the writes land, before the reload below.
      flashAvailabilitySaved();
    }
    // Re-fetch so the upcoming list (and, after a failure, the grid) reflects
    // the server's state.
    await load();
    setSaving(false);
  };

  // complete and no_show are mutually exclusive states, so marking one clears
  // the other. Both lists update at once; the write confirms in the
  // background and puts the attendee's old flags back if it's refused.
  const setChatFlags = (
    rowId: string,
    meetingTime: string,
    flags: { complete?: boolean; no_show?: boolean },
  ) => {
    const before = [...upcomingSlots, ...pastSlots]
      .find((s) => s.meeting_time === meetingTime)
      ?.attendees.find((a) => a.id === rowId);
    const patchWith = (f: { complete?: boolean; no_show?: boolean }) => (prev: UpcomingSlot[]) =>
      prev.map((slot) =>
        slot.meeting_time !== meetingTime
          ? slot
          : { ...slot, attendees: slot.attendees.map((a) => (a.id === rowId ? { ...a, ...f } : a)) },
      );
    const supabase = createClient();
    void optimistic({
      label: "coffee chat",
      key: `coffee-chat:${rowId}`,
      apply: () => {
        setUpcomingSlots(patchWith(flags));
        setPastSlots(patchWith(flags));
      },
      rollback: () => {
        if (!before) return;
        const old = { complete: before.complete, no_show: before.no_show };
        setUpcomingSlots(patchWith(old));
        setPastSlots(patchWith(old));
      },
      commit: () => supabase.from("coffee_chats").update(flags).eq("id", rowId).select("id"),
      requireRows: true,
    });
  };

  const toggleComplete = (rowId: string, meetingTime: string, next: boolean) =>
    setChatFlags(rowId, meetingTime, { complete: next, ...(next ? { no_show: false } : {}) });

  const toggleNoShow = (rowId: string, meetingTime: string, next: boolean) =>
    setChatFlags(rowId, meetingTime, { no_show: next, ...(next ? { complete: false } : {}) });

  // Pull the manager's Google Calendar free/busy across the whole window and
  // auto-fill every editable, currently-empty hour that has no overlapping
  // event, splitting each into the current brush's segments. This only
  // paints the grid — the member reviews and clicks Save to persist. The
  // overlap check stays a conservative full hour regardless of the tagged
  // duration: a shorter appointment still needs a genuinely free hour to
  // land in, and the manager reviews/adjusts before saving anyway.
  const handleSync = async () => {
    setSyncing(true);
    const toastId = toast.loading("Syncing with Google Calendar…");
    try {
      const token = await requestFreeBusyToken();
      const busy = await fetchBusyIntervals(token, rangeStart, rangeEndExclusive);

      let added = 0;
      const next = new Map(selected);
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
      setSelected(next);

      if (added > 0) {
        toast.success(`Added ${added} free ${added === 1 ? "hour" : "hours"} from your calendar`, {
          id: toastId,
          description: "Review the grid, then Save.",
        });
      } else {
        toast.success("No new free hours in this window", { id: toastId });
      }
    } catch (err) {
      toast.error("Couldn't sync with Google Calendar", {
        id: toastId,
        description: err instanceof Error ? err.message : undefined,
      });
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
  // The attendee leaves the slot on screen at once; notify + release run
  // behind it, and a refusal puts them back.
  const cancelBooking = async () => {
    if (!cancelTarget) return false;
    const target = cancelTarget;
    const message = cancelMessage.trim() || null;
    const supabase = createClient();
    const userId = await sessionUserId(supabase);
    if (!userId) return false;
    const upcomingBefore = upcomingSlots;
    const pastBefore = pastSlots;
    const dropAttendee = (prev: UpcomingSlot[]) =>
      prev.map((s) =>
        s.meeting_time !== target.meeting_time
          ? s
          : { ...s, attendees: s.attendees.filter((a) => a.id !== target.id), filled: Math.max(0, s.filled - 1) },
      );
    setCancelMessage("");
    void optimistic({
      label: "cancellation",
      key: `coffee-cancel:${target.id}`,
      apply: () => {
        setUpcomingSlots(dropAttendee);
        setPastSlots(dropAttendee);
      },
      rollback: () => {
        setUpcomingSlots(upcomingBefore);
        setPastSlots(pastBefore);
        setCancelMessage(message ?? "");
      },
      commit: async () => {
        await supabase.rpc("notify_coffee_chat_counterparty", {
          p_chat_id: target.id,
          p_type: "chat_cancelled_by_host",
          p_message: message,
        });
        return supabase
          .from("coffee_chats")
          .update({ applicant_id: null })
          .eq("id", target.id)
          .eq("member_id", userId)
          .select("id");
      },
      requireRows: true,
      onCommitted: () => void load(),
    });
  };

  // Set / update the meeting location for one booked sub-slot (all its seats),
  // then notify each attendee. Setting a value marks the seat as a manual
  // override (location_is_custom = true) so a later default change won't touch
  // it; clearing it reverts to following the host default (location_is_custom =
  // false, location reset to the current default) rather than blanking the
  // booker's view. See migration 0055_coffee_chat_location_is_custom.sql.
  // The slot shows the new location at once; the write follows and the
  // attendee notifications go out in the background once it lands.
  const saveSlotLocation = async () => {
    if (!locationTarget) return false;
    const target = locationTarget;
    const supabase = createClient();
    const userId = await sessionUserId(supabase);
    if (!userId) return false;
    const raw = locationDraft.trim() || null;
    const value = raw ?? (defaultLocation.trim() || null);
    const previous = [...upcomingSlots, ...pastSlots].find((s) => s.meeting_time === target.meeting_time)?.location ?? null;
    const withLocation = (loc: string | null) => (prev: UpcomingSlot[]) =>
      prev.map((s) => (s.meeting_time === target.meeting_time ? { ...s, location: loc } : s));
    void optimistic({
      label: "location",
      key: `coffee-location:${target.meeting_time}`,
      apply: () => {
        setUpcomingSlots(withLocation(value));
        setPastSlots(withLocation(value));
      },
      rollback: () => {
        setUpcomingSlots(withLocation(previous));
        setPastSlots(withLocation(previous));
      },
      commit: () =>
        supabase
          .from("coffee_chats")
          .update({ location: value, location_is_custom: raw !== null })
          .eq("member_id", userId)
          .eq("meeting_time", target.meeting_time)
          .select("id"),
      requireRows: true,
      onCommitted: () => {
        if (!value) return;
        const type = target.hadLocation ? "location_updated" : "location_added";
        for (const id of target.attendeeIds) {
          background(
            () => supabase.rpc("notify_coffee_chat_counterparty", { p_chat_id: id, p_type: type }),
            "notify location change",
          );
        }
      },
    });
  };

  const saveDefaultLocation = () => {
    const supabase = createClient();
    const value = draftDefaultLocation.trim() || null;
    const previous = defaultLocation;
    // Sets the host default AND propagates it to every upcoming booked chat that
    // is following the default (location_is_custom = false), regardless of its
    // current value; manual per-slot overrides are preserved. Affected attendees
    // are notified. See migration 0055_coffee_chat_location_is_custom.sql.
    // Shown at once; the reload afterwards picks up the rewritten slots.
    void optimistic({
      label: "default location",
      key: "coffee-default-location",
      apply: () => {
        setDefaultLocation(value ?? "");
        toastSaved("Default location saved");
      },
      rollback: () => setDefaultLocation(previous),
      commit: () => supabase.rpc("set_default_chat_location", { p_location: value }),
      onCommitted: () => void load(),
    });
  };

  const defaultLocationDirty = draftDefaultLocation.trim() !== defaultLocation.trim();

  const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const canClear = !saving && (selected.size > 0 || dbSlots.size > 0);

  // One booked sub-slot as a list row: when, seats, where; then one sub-row per
  // attendee with attendance and (upcoming only) a ⋯ menu to cancel.
  const renderBookedSlot = (slot: UpcomingSlot, isPast: boolean) => {
    const d = new Date(slot.meeting_time);
    const resolvedLocation = slot.location || defaultLocation.trim() || null;
    return (
      <div key={slot.meeting_time} className="flex flex-col gap-2 rounded-lg px-4 py-3 transition-colors hover:bg-foreground/[0.03]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm font-medium">
            {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            {", "}
            {d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </p>
          <span className="text-xs text-muted-foreground">
            {slot.duration_minutes} min · {slot.filled}/{slot.capacity} {slot.capacity === 1 ? "seat" : "seats"}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <MapPin size={12} className="flex-shrink-0" aria-label="Location" />
            <span className="max-w-[18rem] truncate">{resolvedLocation ?? "No location set"}</span>
            {!isPast && (
              <button
                type="button"
                onClick={() => {
                  setLocationTarget({
                    meeting_time: slot.meeting_time,
                    attendeeIds: slot.attendees.map((a) => a.id),
                    hadLocation: !!slot.location,
                  });
                  setLocationDraft(slot.location ?? "");
                }}
                className="ml-1 rounded-sm underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {slot.location ? "Edit" : "Set"}
              </button>
            )}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {slot.attendees.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() =>
                      openProfile({ userId: a.user_id, name: a.name, preloaded: { email: a.email, avatar_url: a.avatarUrl } })
                    }
                    className="flex min-w-0 items-center gap-2 rounded-sm text-sm transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {a.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold flex-shrink-0">
                        {initials(a.name)}
                      </span>
                    )}
                    <span className="truncate">{a.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{a.email ?? "No email on file"}</TooltipContent>
              </Tooltip>
              <span className="w-0 min-w-0 flex-1 truncate text-xs italic text-muted-foreground">
                {a.message && <>&ldquo;{a.message}&rdquo;</>}
              </span>
              <Segmented
                aria-label={`Attendance — ${a.name}`}
                size="xs"
                shape="soft"
                allowDeselect
                selectOnFocus={false}
                value={a.complete ? "attended" : a.no_show ? "no_show" : ""}
                onChange={(v) => {
                  if (v === "attended") toggleComplete(a.id, slot.meeting_time, true);
                  else if (v === "no_show") toggleNoShow(a.id, slot.meeting_time, true);
                  else if (a.complete) toggleComplete(a.id, slot.meeting_time, false);
                  else toggleNoShow(a.id, slot.meeting_time, false);
                }}
                options={[
                  { value: "attended", label: "Attended", indicatorClassName: "bg-success", selectedTextClassName: "text-success-foreground" },
                  { value: "no_show", label: "No-show", indicatorClassName: "bg-destructive", selectedTextClassName: "text-destructive-foreground" },
                ]}
              />
              {isPast ? (
                <span className="hidden w-7 sm:block" aria-hidden />
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" aria-label={`More for ${a.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => { setCancelTarget({ id: a.id, name: a.name, meeting_time: slot.meeting_time }); setCancelMessage(""); }}
                    >
                      <X />
                      Cancel booking
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-5 flex flex-col gap-6">
      {GOOGLE_CLIENT_ID && (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      )}
      <div className="flex flex-col gap-1">
        <BackLink href="/manager" label="Manager" />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">Coffee chats</h1>
          <Link
            href="/manager/coffee-chats/all"
            className="group inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            View everyone&apos;s availability
            <ArrowRight size={14} aria-hidden className="transition-transform duration-instant ease-out-quart group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {canEditWindow ? (
            // Exec only: the window everyone sets availability within.
            <Popover onOpenChange={(o) => { if (o) { setDraftStart(toDateInputValue(rangeStart)); setDraftEnd(toDateInputValue(rangeEnd)); setWindowError(null); } }}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Coffee chat window"
                  className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {fmtDay(rangeStart)} – {fmtDay(rangeEnd)}
                  <ChevronDown size={14} aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="flex w-auto flex-col gap-3"
                onOpenAutoFocus={(e) => { e.preventDefault(); document.getElementById("window-start")?.focus(); }}
              >
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coffee chat window</p>
                  <InfoHint label="About the window">The date range every host sets availability within.</InfoHint>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Start
                    <Input id="window-start" type="date" value={draftStart} max={draftEnd || undefined} onChange={(e) => setDraftStart(e.target.value)} className="w-40" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    End
                    <Input type="date" value={draftEnd} min={draftStart || undefined} onChange={(e) => setDraftEnd(e.target.value)} className="w-40" />
                  </label>
                </div>
                {windowError && <p className="text-sm text-destructive">{windowError}</p>}
                <Button size="sm" onClick={saveWindow} disabled={!windowDirty} className="self-end">
                  Save
                </Button>
              </PopoverContent>
            </Popover>
          ) : (
            <span>{fmtDay(rangeStart)} – {fmtDay(rangeEnd)}</span>
          )}
          {!loading && (
            <>
              <span aria-hidden className="h-1 w-1 rounded-full bg-muted-foreground/50" />
              <span>{bookedCount} booked</span>
              {bookedCount < SATURDAY_REQUIRED_BELOW && (
                <span className="text-warning">Keep Saturdays open until {SATURDAY_REQUIRED_BELOW} are booked</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Availability grid */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
              disabled={weekOffset === 0}
              aria-label="Previous week"
            >
              <ChevronLeft />
            </Button>
            <h2 className="text-base font-semibold tracking-tight">
              {fmtDay(weekStart)} – {weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setWeekOffset((w) => Math.min(weekCount - 1, w + 1))}
              disabled={weekOffset >= weekCount - 1}
              aria-label="Next week"
            >
              <ChevronRight />
            </Button>
            <InfoHint label="How the grid works">
              <span className="flex flex-col gap-1.5">
                <span>Drag to paint {brushDuration}-minute slots; drag from a filled slot to clear. Save when done.</span>
                <span className="flex items-center gap-1.5"><Lock size={11} aria-hidden /> Booked (hover for who)</span>
                <span className="flex items-center gap-1.5"><MapPin size={11} aria-hidden /> Custom location, not your default</span>
                <span>Each day you open needs at least {MIN_SEATS_PER_DAY} seats.</span>
              </span>
            </InfoHint>
          </div>
          <div className="flex items-center gap-2">
            <Segmented
              aria-label="Slot length"
              size="sm"
              value={String(brushDuration)}
              onChange={(v) => setBrushDuration(Number(v) as Duration)}
              options={DURATIONS.map((d) => ({ value: String(d), label: `${d}m` }))}
            />
            <SaveButton size="sm" saved={availabilitySaved} onClick={handleSave} disabled={!hasChanges || saving} />
            <Popover onOpenChange={(o) => { if (o) setDraftDefaultLocation(defaultLocation); }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label="Default location">
                      <Settings />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Default location</TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                className="flex w-80 flex-col gap-3"
                // Focus the field, not the ? hint (which would pop its tooltip).
                onOpenAutoFocus={(e) => { e.preventDefault(); document.getElementById("default-location")?.focus(); }}
              >
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default location</p>
                  <InfoHint label="About the default location">
                    Where your chats happen unless you set one per chat. Changing it updates every upcoming chat that follows it, and attendees are told.
                  </InfoHint>
                </div>
                <Input
                  value={draftDefaultLocation}
                  onChange={(e) => setDraftDefaultLocation(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && defaultLocationDirty) saveDefaultLocation(); }}
                  placeholder="Room or meeting link"
                  aria-label="Default location"
                  id="default-location"
                />
                <Button size="sm" onClick={saveDefaultLocation} disabled={!defaultLocationDirty} className="self-end">
                  Save
                </Button>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {GOOGLE_CLIENT_ID && (
                  <>
                    <DropdownMenuItem onSelect={() => void handleSync()} disabled={syncing || !settingsReady}>
                      <CalendarCheck />
                      Sync with Google Calendar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onSelect={() => setClearOpen(true)}
                  disabled={!canClear}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 />
                  {bookedCount >= MAY_CLOSE_AT ? "Close remaining availability" : "Clear all availability"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Grid */}
        <ScrollArea orientation="horizontal">
          <div className="min-w-[560px] select-none">
            {/* Day headers */}
            <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] gap-1 mb-1.5">
              <div />
              {weekDates.map((date, i) => {
                const seats = seatsByDate.get(toDateInputValue(date)) ?? 0;
                const belowMin = seats > 0 && seats < MIN_SEATS_PER_DAY;
                const isToday = date.toDateString() === now.toDateString();
                return (
                  <div key={i} className={`flex flex-col items-center gap-0.5 ${inRange(date) ? "" : "opacity-30"}`}>
                    <p className="text-xs text-muted-foreground">{DAY_LABELS[i]}</p>
                    <p
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-sm font-semibold ${
                        isToday ? "bg-foreground text-background" : ""
                      }`}
                    >
                      {date.getDate()}
                    </p>
                    <p className={`h-3.5 text-[10px] ${belowMin ? "text-warning" : "text-muted-foreground"}`}>
                      {inRange(date) && seats > 0 ? `${seats}/${MIN_SEATS_PER_DAY} seats` : ""}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Hour rows: no vertical gap, so each day reads as one tinted strip. */}
            <div className="flex flex-col">
              {HOURS.map((hour, hi) => {
                const firstHour = hi === 0;
                const lastHour = hi === HOURS.length - 1;
                // Continuous column: a light tint rounded only at the ends, a
                // background-coloured hairline between hours.
                const frame = `${firstHour ? "rounded-t-lg" : ""} ${lastHour ? "rounded-b-lg" : "border-b border-b-background"}`;
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

                    if (outOfRange) {
                      return <div key={di} className={`h-9 bg-foreground/[0.015] ${frame}`} />;
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
                    // Segment splits stay visible on fills as background hairlines.
                    const sep = (si: number, on: boolean) =>
                      si ? `border-t ${on ? "border-t-background/60" : "border-t-foreground/[0.04]"}` : "";

                    const cell = (
                      <div className="relative">
                        <div className={`flex flex-col h-9 overflow-hidden bg-foreground/[0.03] ${past ? "opacity-40 cursor-not-allowed" : ""} ${frame}`}>
                          {Array.from({ length: cellDiv }, (_, si) => {
                            const offset = si * cellDur;
                            const locked = !!bookedOffsets?.has(offset);
                            if (locked) {
                              // Booked sub-slot: locked, non-interactive.
                              return (
                                <div
                                  key={si}
                                  className={`flex-1 flex items-center justify-center bg-foreground/75 text-background cursor-not-allowed ${sep(si, true)}`}
                                >
                                  <Lock size={10} aria-label="Booked" />
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
                                  className={`flex-1 touch-none transition-colors ${sep(si, existing)} ${
                                    past ? "" : "cursor-pointer"
                                  } ${existing ? "bg-foreground/25" : past ? "" : "hover:bg-foreground/10"}`}
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
                            return (
                              <div
                                key={si}
                                onPointerDown={past ? undefined : (e) => { e.preventDefault(); startDrag(di, hi, bi, date, hour); }}
                                onPointerEnter={past ? undefined : () => { if (dragState) setDragCurrent({ di, fi: hi * div + bi }); }}
                                className={`flex-1 touch-none transition-colors ${sep(si, filled)} ${
                                  segInDrag ? "ring-1 ring-inset ring-ring " : ""
                                }${filled ? "bg-foreground/25" : past ? "" : "hover:bg-foreground/10"}`}
                              />
                            );
                          })}
                        </div>
                        {hasLocationOverride && (
                          <span className="pointer-events-none absolute top-0 right-0 z-[1] flex items-center justify-center w-3 h-3 rounded-bl bg-background text-foreground">
                            <MapPin size={7} aria-label="Custom location" />
                          </span>
                        )}
                      </div>
                    );
                    if (bookedInfos.length === 0) {
                      return cloneElement(cell, { key: di });
                    }
                    return (
                      <Tooltip key={di}>
                        <TooltipTrigger asChild>{cell}</TooltipTrigger>
                        <SlotTooltip infos={bookedInfos} defaultLocation={defaultLocation} />
                      </Tooltip>
                    );
                  })}
                </div>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      </section>

      {/* Booked chats: upcoming, then past behind a disclosure. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">
          Upcoming
          {!loading && <span className="ml-1.5 font-normal text-muted-foreground">{bookedUpcoming.length}</span>}
        </h2>
        {loading ? (
          <BookedChatsSkeleton />
        ) : bookedUpcoming.length === 0 && bookedPast.length === 0 ? (
          <p className="rounded-xl surface px-4 py-8 text-center text-sm text-muted-foreground">No chats booked yet</p>
        ) : bookedUpcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing coming up.</p>
        ) : (
          <div className="-mx-4 flex flex-col gap-0.5">{bookedUpcoming.map((slot) => renderBookedSlot(slot, false))}</div>
        )}
        {!loading && bookedPast.length > 0 && (
          <Disclosure label={`Past ${bookedPast.length}`} className="pt-2">
            <div className="-mx-4 -mt-2 flex flex-col gap-0.5 [contain:inline-size]">{bookedPast.map((slot) => renderBookedSlot(slot, true))}</div>
          </Disclosure>
        )}
      </section>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={bookedCount >= MAY_CLOSE_AT ? "Close remaining availability?" : "Clear all availability?"}
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
        <Textarea
          value={cancelMessage}
          onChange={(e) => setCancelMessage(e.target.value)}
          placeholder="Optional message, e.g. a reason or a nudge to rebook"
          aria-label="Message to the attendee"
          rows={3}
          className="resize-none"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={locationTarget !== null}
        onOpenChange={(o) => { if (!o) setLocationTarget(null); }}
        title="Meeting location"
        description="Attendees are notified and see it on their booking."
        confirmLabel="Save location"
        destructive={false}
        onConfirm={saveSlotLocation}
      >
        <div className="flex items-center gap-2">
          <Input
            value={locationDraft}
            onChange={(e) => setLocationDraft(e.target.value)}
            placeholder={defaultLocation.trim() || "Room or meeting link"}
            aria-label="Location"
          />
          {locationDraft !== "" && (
            <Button variant="ghost" size="sm" onClick={() => setLocationDraft("")}>
              Use default
            </Button>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
