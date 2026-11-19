"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ResumePagePlaceholder } from "@/components/resume-review/page-placeholder";
import type { ResumeFile } from "@/lib/resume-upload";
import { ResumeDownloadButton } from "@/components/resume-review/resume-file-actions";
import type { ResumeReviewContext } from "@/components/resume-review/resume-review-workspace";

function WorkspaceSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-foreground/[0.04]">
      <ResumePagePlaceholder />
    </div>
  );
}

// Split out so the PDF library never weighs down the pages behind the modal.
type Workspace = typeof import("@/components/resume-review/resume-review-workspace").ResumeReviewWorkspace;
let preloaded: Workspace | null = null;
const loadWorkspace = () =>
  import("@/components/resume-review/resume-review-workspace").then((m) => {
    preloaded = m.ResumeReviewWorkspace;
    return m;
  });
// Used only if the modal opens before the preload below has finished.
const DynamicWorkspace = dynamic(() => loadWorkspace().then((m) => m.ResumeReviewWorkspace), {
  ssr: false,
  loading: WorkspaceSkeleton,
});

// Fetched once the page is idle rather than on click. Loading it on click froze
// the main thread mid open-animation, so the modal skipped frames and popped in.
function usePreloadWorkspace() {
  useEffect(() => {
    const preload = () => void loadWorkspace();
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(preload, 1500);
    return () => clearTimeout(id);
  }, []);
}

// An unfinished note shouldn't vanish because of Escape or a stray click.
const keepOpenWhileWriting = (event: Event) => {
  if (document.querySelector("[data-note-composer]")) event.preventDefault();
};

// Focus the dialog itself. By default it lands on the first button, Download,
// which then shows its focus ring and tooltip as if it had been hovered.
const focusDialog = (event: Event) => {
  event.preventDefault();
  (event.currentTarget as HTMLElement).focus();
};

export function ResumeReviewModal({
  file,
  review,
  onOpenChange,
  onChanged,
}: {
  /** The file on screen; null keeps the modal closed. */
  file: ResumeFile | null;
  review?: ResumeReviewContext;
  onOpenChange: (open: boolean) => void;
  /** Runs when feedback is sent, so the page behind can refresh. */
  onChanged?: () => void;
}) {
  usePreloadWorkspace();
  const fileKey = file ? `${file.bucket}/${file.path}` : null;
  // Chosen once per file. next/dynamic shows its fallback for a frame even when
  // the module is already loaded, and that fallback has no notes column, so the
  // layout jumped. Switching mid-view would remount and lose an unsaved note.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ResumeReviewWorkspace = useMemo(() => preloaded ?? DynamicWorkspace, [fileKey]);

  return (
    <Dialog open={file !== null} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={focusDialog}
        onEscapeKeyDown={keepOpenWhileWriting}
        onInteractOutside={keepOpenWhileWriting}
        className="flex h-[calc(100svh-1rem)] max-h-none w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 outline-none data-[state=open]:!zoom-in-[.98] data-[state=closed]:!zoom-out-[.98]"
      >
        {file && (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 border-b pl-4 pr-12">
              <DialogTitle className="min-w-0 flex-1 truncate text-base" title={file.filename}>
                {file.filename}
              </DialogTitle>
              <ResumeDownloadButton file={file} />
            </div>
            <ResumeReviewWorkspace
              key={fileKey}
              file={file}
              review={review}
              onSent={() => {
                onChanged?.();
                onOpenChange(false);
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
