"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { CoffeeChatIndicator, InfosessionIndicator, type CoffeeState } from "@/components/applicant-indicators";
import { isReturningMember, type MemberStatus } from "@/lib/member-status";
import { cn } from "@/lib/utils";
import { optimistic } from "@/lib/optimistic";
import { Segmented } from "@/components/ui/segmented";
import { toastSaved } from "@/lib/saved-toast";

type HostOption = { user_id: string; name: string };

function useDialogContainer() {
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const probeRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) setDialogContainer(node.closest<HTMLElement>("[role='dialog']"));
  }, []);
  return { dialogContainer, probeRef };
}

async function loadCoffeeHosts(): Promise<HostOption[]> {
  const supabase = createClient();
  const [{ data: boardExecEntries }, { data: pmEntries }] = await Promise.all([
    supabase
      .from("members_roles")
      .select("user_id, roles!inner(access_level)")
      .in("roles.access_level", ["board", "exec"]),
    supabase.from("project_members").select("user_id").eq("is_pm", true),
  ]);
  const userIds = [
    ...new Set([
      ...(boardExecEntries ?? []).map((e) => e.user_id).filter(Boolean),
      ...(pmEntries ?? []).map((e) => e.user_id).filter(Boolean),
    ]),
  ] as string[];
  if (!userIds.length) return [];
  const { data: profiles } = await supabase
    .from("members")
    .select("user_id, preferred_firstname, lastname")
    .in("user_id", userIds);
  return ((profiles ?? []) as { user_id: string; preferred_firstname: string | null; lastname: string | null }[])
    .map((p) => ({
      user_id: p.user_id,
      name: [p.preferred_firstname, p.lastname].filter(Boolean).join(" ") || "Member",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type CoffeeEditResult = {
  coffee: CoffeeState;
  coffeeWith: string[];
  coffeeHostIds: string[];
};

export function SheetCoffeeCell({
  applicantId,
  state,
  withNames,
  hostIds,
  onSaved,
}: {
  applicantId: string;
  state: CoffeeState;
  withNames: string[];
  hostIds: string[];
  onSaved: (next: CoffeeEditResult) => void;
}) {
  const { dialogContainer, probeRef } = useDialogContainer();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CoffeeState>(state);
  const [hostId, setHostId] = useState<string | null>(hostIds[0] ?? null);
  const [hosts, setHosts] = useState<HostOption[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const primaryHostId = hostIds[0] ?? null;

  useEffect(() => {
    if (!open) return;
    setStatus(state);
    setHostId(primaryHostId);
    setSearch("");
    setError(null);
    let cancelled = false;
    loadCoffeeHosts().then((list) => {
      if (!cancelled) setHosts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, state, primaryHostId]);

  const filteredHosts = useMemo(() => {
    if (!hosts) return [];
    const q = search.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) => h.name.toLowerCase().includes(q));
  }, [hosts, search]);

  const save = async () => {
    if (status !== "none" && !hostId) {
      setError("Pick who coffee chatted them");
      return;
    }
    setError(null);
    const supabase = createClient();
    const hostName = hosts?.find((h) => h.user_id === hostId)?.name;
    const before: CoffeeEditResult = { coffee: state, coffeeWith: withNames, coffeeHostIds: hostIds };
    // The cell updates and the popover closes at once; the RPC confirms behind.
    void optimistic({
      label: "coffee chat status",
      key: `sheet-coffee:${applicantId}`,
      apply: () => {
        onSaved({
          coffee: status,
          coffeeWith: status === "none" || !hostName ? [] : [hostName],
          coffeeHostIds: status === "none" || !hostId ? [] : [hostId],
        });
        setOpen(false);
        toastSaved();
      },
      rollback: () => onSaved(before),
      commit: () =>
        supabase.rpc("set_applicant_coffee_chat", {
          p_applicant_id: applicantId,
          p_status: status,
          p_host_id: status === "none" ? null : hostId,
        }),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span ref={probeRef} className="hidden" aria-hidden />
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-[1.25rem] items-center rounded px-0.5 text-left hover:bg-accent"
          aria-label="Edit coffee chat"
        >
          {state === "none" ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <CoffeeChatIndicator state={state} withNames={withNames} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent container={dialogContainer} align="start" className="w-72 space-y-3 p-3">
        <Segmented
          aria-label="Coffee chat"
          value={status}
          onChange={setStatus}
          className="w-full"
          itemClassName="flex-1"
          options={[
            { value: "none", label: "None" },
            { value: "booked", label: "Booked" },
            { value: "done", label: "Done", indicatorClassName: "bg-success", selectedTextClassName: "text-success-foreground" },
          ]}
        />
        {status !== "none" && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">With</p>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hosts…"
              className="h-8"
            />
            <ScrollArea className="h-36 rounded-md bg-foreground/[0.03]">
              <div className="p-1">
                {!hosts ? (
                  <div aria-hidden className="flex flex-col">
                    {[60, 45, 70, 50, 55].map((w) => (
                      <div key={w} className="flex h-8 items-center px-2">
                        <Skeleton className="h-3.5 rounded-full" style={{ width: `${w}%` }} />
                      </div>
                    ))}
                  </div>
                ) : filteredHosts.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No matches</p>
                ) : (
                  filteredHosts.map((h) => (
                    <button
                      key={h.user_id}
                      type="button"
                      className={cn(
                        "flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                        hostId === h.user_id && "bg-accent",
                      )}
                      onClick={() => setHostId(h.user_id)}
                    >
                      {h.name}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SheetInfosessionCell({
  applicantId,
  attended,
  onSaved,
}: {
  applicantId: string;
  attended: boolean;
  onSaved: (attended: boolean) => void;
}) {
  const { dialogContainer, probeRef } = useDialogContainer();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(attended);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(attended);
    setError(null);
  }, [open, attended]);

  // One click writes: picking an option applies it and closes.
  const save = (value: boolean) => {
    setValue(value);
    if (value === attended) {
      setOpen(false);
      return;
    }
    setError(null);
    const supabase = createClient();
    const before = attended;
    void optimistic({
      label: "info session status",
      key: `sheet-infosession:${applicantId}`,
      apply: () => {
        onSaved(value);
        setOpen(false);
      },
      rollback: () => onSaved(before),
      commit: () => supabase.rpc("set_applicant_infosession", { p_applicant_id: applicantId, p_attended: value }),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span ref={probeRef} className="hidden" aria-hidden />
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-[1.25rem] items-center rounded px-0.5 text-left hover:bg-accent"
          aria-label="Edit info session"
        >
          {attended ? (
            <InfosessionIndicator attended />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent container={dialogContainer} align="start" className="w-56 space-y-3 p-3">
        <Segmented
          aria-label="Info session"
          value={value ? "yes" : "no"}
          onChange={(v) => save(v === "yes")}
          className="w-full"
          itemClassName="flex-1"
          options={[
            { value: "no", label: "Not attended" },
            { value: "yes", label: "Attended", indicatorClassName: "bg-success", selectedTextClassName: "text-success-foreground" },
          ]}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

export function SheetReturningCell({
  applicantId,
  returning,
  memberStatus,
  onSaved,
}: {
  applicantId: string;
  returning: boolean;
  memberStatus: MemberStatus | null;
  onSaved: (returning: boolean, memberStatus: MemberStatus) => void;
}) {
  const { dialogContainer, probeRef } = useDialogContainer();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(returning);
  const [error, setError] = useState<string | null>(null);

  const editable = memberStatus === "non_member" || memberStatus === "inactive";

  useEffect(() => {
    if (!open) return;
    setValue(returning);
    setError(null);
  }, [open, returning]);

  const save = (value: boolean) => {
    if (!editable) return;
    setValue(value);
    const nextStatus: MemberStatus = value ? "inactive" : "non_member";
    if (nextStatus === memberStatus) {
      setOpen(false);
      return;
    }
    setError(null);
    const supabase = createClient();
    const beforeStatus = memberStatus;
    void optimistic({
      label: "member status",
      key: `status:${applicantId}`,
      apply: () => {
        onSaved(isReturningMember(nextStatus), nextStatus);
        setOpen(false);
      },
      rollback: () => onSaved(isReturningMember(beforeStatus), beforeStatus),
      commit: () => supabase.rpc("set_member_status", { p_user_id: applicantId, p_status: nextStatus }),
    });
  };

  const display = returning ? (
    <span className="font-medium text-foreground">Yes</span>
  ) : (
    <span className="text-muted-foreground">No</span>
  );

  if (!editable) {
    return (
      <span
        title={
          memberStatus === "active"
            ? "Active members stay returning; change status on the Admin page"
            : memberStatus === "blacklisted"
              ? "Blacklisted status can’t be flipped here; change it on the Admin page"
              : undefined
        }
      >
        {display}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span ref={probeRef} className="hidden" aria-hidden />
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-[1.25rem] items-center rounded px-0.5 text-left hover:bg-accent"
          aria-label="Edit returning status"
        >
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent container={dialogContainer} align="start" className="w-56 space-y-3 p-3">
        <p className="text-xs font-medium text-muted-foreground">Returning member</p>
        <Segmented
          aria-label="Returning member"
          value={value ? "yes" : "no"}
          onChange={(v) => save(v === "yes")}
          className="w-full"
          itemClassName="flex-1"
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes" },
          ]}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
