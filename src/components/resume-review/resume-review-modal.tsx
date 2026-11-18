"use client";

import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResumeFile } from "@/lib/resume-upload";
import { ResumeDownloadButton } from "@/components/resume-review/resume-file-actions";
import type { ResumeReviewContext } from "@/components/resume-review/resume-review-workspace";

function WorkspaceSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center bg-foreground/[0.04] p-4">
      <Skeleton className="aspect-[8.5/11] h-full max-w-full rounded-none" />
    </div>
  );
}

// Loaded on open so the PDF library never weighs down the pages behind it.
const ResumeReviewWorkspace = dynamic(
  () => import("@/components/resume-review/resume-review-workspace").then((m) => m.ResumeReviewWorkspace),
  { ssr: false, loading: WorkspaceSkeleton },
);

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
  return (
    <Dialog open={file !== null} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={focusDialog}
        onEscapeKeyDown={keepOpenWhileWriting}
        onInteractOutside={keepOpenWhileWriting}
        className="flex h-[calc(100svh-1rem)] max-h-none w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 outline-none"
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
              key={`${file.bucket}/${file.path}`}
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
