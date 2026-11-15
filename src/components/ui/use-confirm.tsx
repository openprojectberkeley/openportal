"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Request = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  /** Red confirm button: for changes that remove access. */
  destructive?: boolean;
  run: () => void;
};

/**
 * Ask before an access change (roles, member status, PM/admin), then run it.
 * `ask({...})` opens the dialog; `dialog` is rendered once by the caller.
 * The change itself stays optimistic: it applies the moment Confirm is clicked.
 */
export function useConfirm() {
  const [req, setReq] = useState<Request | null>(null);
  const ask = useCallback((r: Request) => setReq(r), []);
  const dialog = (
    <ConfirmDialog
      open={req !== null}
      onOpenChange={(o) => {
        if (!o) setReq(null);
      }}
      title={req?.title ?? ""}
      description={req?.description}
      confirmLabel={req?.confirmLabel ?? "Confirm"}
      destructive={req?.destructive ?? false}
      onConfirm={() => {
        req?.run();
        return true;
      }}
    />
  );
  return { ask, dialog };
}
