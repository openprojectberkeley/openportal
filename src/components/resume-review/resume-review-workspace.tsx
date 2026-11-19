"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compareNotes } from "@/lib/resume-note-geometry";
import { fetchResumeBlob, type ResumeFile } from "@/lib/resume-upload";
import { useResumeReview, type NoteTarget } from "@/lib/use-resume-review";
import { useRoleSim } from "@/components/role-simulation-provider";
import { NoteLayer } from "@/components/resume-review/note-layer";
import { NotesPanel } from "@/components/resume-review/notes-panel";
import { PdfPane } from "@/components/resume-review/pdf-pane";
import { ResumePagePlaceholder } from "@/components/resume-review/page-placeholder";

export type ResumeReviewContext = {
  id: string;
  status: "pending" | "completed" | "cancelled";
  requesterName: string | null;
  targetRoles: string | null;
  neededBy: string | null;
  feedback: string | null;
  reviewerName: string | null;
};

export function ResumeReviewWorkspace({
  file,
  review,
  onSent,
}: {
  file: ResumeFile;
  review?: ResumeReviewContext;
  onSent: () => void;
}) {
  const { isExec } = useRoleSim();
  const canEdit = Boolean(review && isExec && review.status === "pending");
  const showNotes = Boolean(review && (canEdit || review.status === "completed"));
  const data = useResumeReview(showNotes && review ? review.id : null, canEdit);

  const rootRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [target, setTarget] = useState<NoteTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchResumeBlob(createClient(), file).then((result) => {
      if (cancelled) return;
      if (result) setBlob(result);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const notes = useMemo(() => (data.notes ? [...data.notes].sort(compareNotes) : null), [data.notes]);
  const numbers = useMemo(() => new Map((notes ?? []).map((n, i) => [n.id, i + 1])), [notes]);

  const reveal = (attribute: "note-mark" | "note-item", id: string) => {
    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector(`[data-${attribute}="${id}"]`)
        ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    });
  };

  const startNote = (next: NoteTarget) => {
    setSelectedId(null);
    setTarget(next);
  };

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className={showNotes ? "min-h-0 flex-1" : "min-h-0 flex-1 lg:col-span-2"}>
        {failed ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            This resume can&apos;t be shown here. Try downloading it.
          </p>
        ) : blob ? (
          <PdfPane
            blob={blob}
            onFailed={() => setFailed(true)}
            renderPageOverlay={
              showNotes
                ? (page) => (
                    <NoteLayer
                      page={page}
                      notes={(notes ?? []).filter((n) => n.page === page)}
                      numbers={numbers}
                      selectedId={selectedId}
                      target={target}
                      canAnnotate={canEdit}
                      onTarget={startNote}
                      onSelect={(id) => {
                        setSelectedId(id);
                        reveal("note-item", id);
                      }}
                    />
                  )
                : undefined
            }
          />
        ) : (
          <div className="h-full overflow-hidden bg-foreground/[0.04]">
            <ResumePagePlaceholder />
          </div>
        )}
      </div>

      {showNotes && review && (
        <NotesPanel
          review={review}
          canEdit={canEdit}
          notes={notes}
          numbers={numbers}
          authors={data.authors}
          draft={data.draft}
          selectedId={selectedId}
          target={target}
          onDraftChange={data.setDraft}
          onSelect={(id) => {
            setSelectedId(id);
            reveal("note-mark", id);
          }}
          onCancelTarget={() => setTarget(null)}
          onAdd={(body) => {
            if (!target) return;
            setSelectedId(data.addNote(target, body));
            setTarget(null);
          }}
          onUpdate={data.updateNote}
          onDelete={(note) => {
            data.deleteNote(note);
            if (selectedId === note.id) setSelectedId(null);
          }}
          onBeforeSend={data.refresh}
          onSend={() => {
            void data.send().then((sent) => {
              if (sent) onSent();
            });
          }}
        />
      )}
    </div>
  );
}
