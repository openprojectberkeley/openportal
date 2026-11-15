import { describe, expect, it, vi, beforeEach } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import { optimistic } from "@/lib/optimistic";

beforeEach(() => toastError.mockReset());

describe("optimistic", () => {
  it("applies before the commit resolves and keeps the change on success", async () => {
    const order: string[] = [];
    const ok = await optimistic({
      label: "thing",
      apply: () => order.push("apply"),
      rollback: () => order.push("rollback"),
      commit: async () => {
        order.push("commit");
        return { error: null, data: [{ id: 1 }] };
      },
    });
    expect(ok).toBe(true);
    expect(order).toEqual(["apply", "commit"]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("rolls back and toasts with Retry when the commit returns an error", async () => {
    const rollback = vi.fn();
    const ok = await optimistic({
      label: "role",
      key: "t:error",
      apply: () => {},
      rollback,
      commit: async () => ({ error: { message: "permission denied" } }),
    });
    expect(ok).toBe(false);
    expect(rollback).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't save role",
      expect.objectContaining({ description: "permission denied", action: expect.objectContaining({ label: "Retry" }) }),
    );
  });

  it("rolls back when the commit throws (network failure)", async () => {
    const rollback = vi.fn();
    await optimistic({
      label: "x",
      key: "t:throw",
      apply: () => {},
      rollback,
      commit: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("treats zero affected rows as a refusal when requireRows is set (RLS)", async () => {
    const rollback = vi.fn();
    const ok = await optimistic({
      label: "x",
      key: "t:rls",
      apply: () => {},
      rollback,
      commit: async () => ({ error: null, data: [] }),
      requireRows: true,
    });
    expect(ok).toBe(false);
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("does not roll back a stale failure once a newer change to the same key exists", async () => {
    let failFirst!: (v: { error: { message: string } }) => void;
    const rollbackFirst = vi.fn();
    const first = optimistic({
      label: "x",
      key: "t:stale",
      apply: () => {},
      rollback: rollbackFirst,
      commit: () => new Promise<{ error: { message: string } }>((res) => (failFirst = res)),
    });
    await optimistic({
      label: "x",
      key: "t:stale",
      apply: () => {},
      rollback: () => {},
      commit: async () => ({ error: null }),
    });
    failFirst({ error: { message: "late failure" } });
    expect(await first).toBe(false);
    expect(rollbackFirst).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("Retry re-applies and re-commits", async () => {
    let attempts = 0;
    const apply = vi.fn();
    await optimistic({
      label: "x",
      key: "t:retry",
      apply,
      rollback: () => {},
      commit: async () => (++attempts === 1 ? { error: { message: "nope" } } : { error: null }),
    });
    const retry = toastError.mock.calls[0][1].action.onClick as () => void;
    retry();
    await new Promise((r) => setTimeout(r, 0));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(attempts).toBe(2);
  });
});
