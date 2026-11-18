"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fetchResumeBlob, saveBlob, type ResumeFile } from "@/lib/resume-upload";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const iconButton =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground/80 transition-colors hover:bg-foreground/[0.1] hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function ResumeDownloadButton({ file, className }: { file: ResumeFile; className?: string }) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    const blob = await fetchResumeBlob(createClient(), file);
    setBusy(false);
    if (blob) saveBlob(blob, file.filename);
    else toast.error("Couldn't download that resume.");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={download}
          disabled={busy}
          aria-label={`Download ${file.filename}`}
          className={cn(iconButton, className)}
        >
          <Download size={15} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Download</TooltipContent>
    </Tooltip>
  );
}

/** Icon-only resume controls. The filename appears on hover and in the viewer. */
export function ResumeFileActions({
  file,
  onOpen,
  className,
}: {
  file: ResumeFile;
  /** Leave out for files the viewer can't show, such as Word documents. */
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {onOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={onOpen} aria-label={`Open ${file.filename}`} className={iconButton}>
              <FileText size={15} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{file.filename}</TooltipContent>
        </Tooltip>
      )}
      <ResumeDownloadButton file={file} />
    </div>
  );
}
