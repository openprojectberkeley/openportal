"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSemesters } from "@/lib/use-semesters";
import { CATEGORY_META, isEventCategory } from "@/lib/event-category";
import {
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_PILL,
  attendanceRate,
  countAttendance,
  inSemester,
  type AttendanceStatus,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  status: AttendanceStatus;
  event: {
    id: string;
    title: string;
    start_time: string;
    category: string;
    portal: { name: string } | null;
  };
};

type RawRow = {
  id: string;
  status: AttendanceStatus;
  portal_events: {
    id: string;
    title: string;
    start_time: string;
    category: string;
    portals: { name: string } | { name: string }[] | null;
  } | null;
};

const ALL = "all";

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The signed-in member's own attendance. RLS on portal_event_attendance
 * (0011/0095) already scopes reads to `user_id = auth.uid()` for non-admins;
 * the explicit filter keeps admins (who can read more) to their own rows too.
 */
export default function AttendancePage() {
  const { semesters, active } = useSemesters();
  const [picked, setPicked] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        if (!cancelled) setRows([]);
        return;
      }
      const { data, error: loadError } = await supabase
        .from("portal_event_attendance")
        // `portals!portal_id`: portal_events reaches portals both directly and
        // through portal_imported_events (0102), so the embed must name the FK.
        .select("id, status, portal_events(id, title, start_time, category, portals!portal_id(name))")
        .eq("user_id", userId);
      if (cancelled) return;
      if (loadError) {
        console.error("[attendance] load failed:", loadError);
        setError("Couldn't load your attendance.");
        setRows([]);
        return;
      }
      const mapped = ((data ?? []) as unknown as RawRow[])
        .filter((r) => r.portal_events)
        .map((r) => {
          const e = r.portal_events!;
          const portal = Array.isArray(e.portals) ? (e.portals[0] ?? null) : e.portals;
          return {
            id: r.id,
            status: r.status,
            event: { id: e.id, title: e.title, start_time: e.start_time, category: e.category, portal },
          };
        })
        .sort((a, b) => b.event.start_time.localeCompare(a.event.start_time));
      setRows(mapped);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const semesterId = picked ?? active?.id ?? ALL;
  const semester = semesters?.find((s) => s.id === semesterId) ?? null;

  const visible = useMemo(() => {
    if (!rows) return null;
    if (!semester) return rows;
    return rows.filter((r) => inSemester(r.event.start_time, semester.starts_on, semester.ends_on));
  }, [rows, semester]);

  const counts = countAttendance((visible ?? []).map((r) => r.status));
  const rate = attendanceRate(counts);

  return (
    <div className="w-full max-w-3xl mx-auto p-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Attendance</h1>
        {semesters !== null && semesters.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors">
                {semester?.name ?? "All time"}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {semesters.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => setPicked(s.id)}>
                  {s.name}
                  {s.is_active && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Active
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setPicked(ALL)}>All time</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {visible === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Attendance rate" value={rate === null ? "—" : `${rate}%`} />
            <Stat label="Present" value={counts.present} />
            <Stat label="Absent" value={counts.absent} />
            <Stat label="Excused" value={counts.excused} />
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            Excused absences count as half.
          </p>

          <div className="border rounded-lg overflow-hidden">
            {visible.map((r, i) => {
              const cat = isEventCategory(r.event.category) ? CATEGORY_META[r.event.category] : null;
              return (
                <div key={r.id} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t")}>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: cat?.color ?? "#64748b" }}
                    title={cat?.label}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{r.event.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatEventDate(r.event.start_time)} · {r.event.portal?.name ?? "Club"}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      ATTENDANCE_STATUS_PILL[r.status],
                    )}
                  >
                    {ATTENDANCE_STATUS_LABEL[r.status]}
                  </span>
                </div>
              );
            })}
            {visible.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No attendance recorded yet.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}
