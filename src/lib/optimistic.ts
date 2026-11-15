// Optimistic writes: show the change now, confirm with the backend in the
// background, and undo it (with a toast and a Retry) only if the backend says
// no. Every user-driven edit that the server can't meaningfully veto should go
// through this, so the UI never waits on a round trip to reflect a click.
//
// Modelled on all-projects-board.tsx's withPendingOutcomes: a per-key sequence
// number means a slow response to an older click can never roll back (or
// overwrite) a newer one.

import { toast } from "sonner";

/** What a Supabase query (or any commit) resolves to. */
type CommitResult =
  | { error?: { message?: string } | null; data?: unknown }
  | void
  | undefined
  | null;

export type OptimisticOptions<R extends CommitResult> = {
  /** Updates local state to the new value. Runs synchronously, first. */
  apply: () => void;
  /** Puts local state back. Runs only if the commit fails and no newer change to the same key has been made since. */
  rollback: () => void;
  /** The backend write. Supabase builders are thenables, so `() => supabase.from(..).update(..)` works directly. */
  commit: () => PromiseLike<R>;
  /** Noun for the error toast: "Couldn't save <label>". */
  label: string;
  /**
   * Groups writes to the same thing (e.g. `attendance:${userId}:${eventId}`)
   * so only the latest one's failure rolls back. Defaults to `label`.
   */
  key?: string;
  /**
   * Treat an empty `data` array as a failure. RLS refuses an UPDATE/DELETE by
   * matching zero rows, with no error, so a write that must land should
   * `.select()` and set this.
   */
  requireRows?: boolean;
  /** Runs after a successful commit (e.g. swap a temp id for the real row). */
  onCommitted?: (result: R) => void;
  /** Runs after a failed commit, after rollback. */
  onFailed?: (message: string) => void;
};

const latest = new Map<string, number>();

function failureMessage(result: CommitResult, requireRows: boolean): string | null {
  if (!result || typeof result !== "object") return null;
  const err = "error" in result ? result.error : null;
  if (err) return err.message || "Something went wrong.";
  if (requireRows && "data" in result) {
    const data = result.data;
    if (data == null || (Array.isArray(data) && data.length === 0)) {
      return "You may not have permission to change this.";
    }
  }
  return null;
}

/**
 * Applies a change locally, commits it in the background, and rolls back with
 * an error toast (offering Retry) if the commit fails. Resolves to whether the
 * commit succeeded; callers rarely need to await it.
 */
export async function optimistic<R extends CommitResult>(opts: OptimisticOptions<R>): Promise<boolean> {
  const key = opts.key ?? opts.label;
  const token = (latest.get(key) ?? 0) + 1;
  latest.set(key, token);

  opts.apply();

  let message: string | null;
  let result: R | undefined;
  try {
    result = await opts.commit();
    message = failureMessage(result, !!opts.requireRows);
  } catch (e) {
    message = e instanceof Error ? e.message : "Network error.";
  }

  if (message === null) {
    opts.onCommitted?.(result as R);
    return true;
  }

  // A newer change to the same thing is already in flight or landed; it owns
  // the state now, so don't undo it.
  if (latest.get(key) !== token) return false;

  opts.rollback();
  opts.onFailed?.(message);
  // Take back an instant "Saved" cue (saved-toast.ts) for this change.
  toast.dismiss("saved");
  toast.error(`Couldn't save ${opts.label}`, {
    description: message,
    action: { label: "Retry", onClick: () => void optimistic(opts) },
  });
  return false;
}

/** Fire-and-forget background work tied to an already-applied change (e.g. a notification RPC). Failures are logged, not surfaced. */
export function background(work: () => PromiseLike<unknown>, what: string): void {
  Promise.resolve()
    .then(work)
    .then(
      (r) => {
        const err = r && typeof r === "object" && "error" in r ? (r as { error: unknown }).error : null;
        if (err) console.warn(`[background] ${what} failed`, err);
      },
      (e) => console.warn(`[background] ${what} failed`, e),
    );
}

/**
 * The signed-in user's id without a network round trip. `auth.getUser()`
 * revalidates against the auth server on every call, which is the wrong cost
 * in front of an optimistic write; the session is already in local storage,
 * and RLS on the write itself is what actually enforces identity.
 */
export async function sessionUserId(supabase: {
  auth: { getSession: () => Promise<{ data: { session: { user: { id: string } } | null } }> };
}): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
