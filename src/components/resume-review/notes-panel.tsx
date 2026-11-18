"use client";

import { useState } from "react";
import { Pencil, Send, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { InfoHint } from "@/components/ui/info-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import type { NoteTarget, ResumeNote } from "@/lib/use-resume-review";
import type { ResumeReviewContext } from "@/components/resume-review/resume-review-workspace";
import { cn } from "@/lib/utils";

const MAX_NOTE = 4000;

function NoteEditor({
  initial = "",
  quote,
  label,
  onSave,
  onCancel,
}: {
  initial?: string;
  quote?: string | null;
  label: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial);
  const save = () => {
    if (body.trim()) onSave(body.trim());
  };
  return (
    <div data-note-composer className="flex flex-col gap-2 rounded-lg border bg-background p-2.5">
      {quote && <p className="line-clamp-2 text-xs italic text-muted-foreground">{quote}</p>}
      <Textarea
        autoFocus
        rows={3}
        maxLength={MAX_NOTE}
        value={body}
        aria-label={label}
        placeholder="Your note…"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!body.trim()}
          className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function NotesPanel({
  review,
  canEdit,
  notes,
  numbers,
  authors,
  draft,
  selectedId,
  target,
  onDraftChange,
  onSelect,
  onCancelTarget,
  onAdd,
  onUpdate,
  onDelete,
  onSend,
  onBeforeSend,
}: {
  review: ResumeReviewContext;
  canEdit: boolean;
  notes: ResumeNote[] | null;
  numbers: Map<string, number>;
  authors: Record<string, string>;
  draft: string;
  selectedId: string | null;
  target: NoteTarget | null;
  onDraftChange: (body: string) => void;
  onSelect: (id: string) => void;
  onCancelTarget: () => void;
  onAdd: (body: string) => void;
  onUpdate: (note: ResumeNote, body: string) => void;
  onDelete: (note: ResumeNote) => void;
  onSend: () => void;
  onBeforeSend: () => Promise<ResumeNote[] | null>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  const multiPage = notes?.some((n) => n.page > 1) ?? false;
  const canSend = Boolean(draft.trim() || notes?.length);

  const confirmSend = async () => {
    const latest = (await onBeforeSend()) ?? notes ?? [];
    const count = latest.length;
    ask({
      title: `Send feedback to ${review.requesterName ?? "the requester"}?`,
      description: count ? `Includes ${count} ${count === 1 ? "note" : "notes"}. This can't be edited afterward.` : "This can't be edited afterward.",
      confirmLabel: "Send",
      run: onSend,
    });
  };

  return (
    <aside className="flex max-h-[45%] min-h-0 flex-col border-t lg:max-h-none lg:border-l lg:border-t-0">
      {dialog}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="flex flex-col gap-5 p-4 pr-5">
        {(review.requesterName || review.targetRoles || review.neededBy) && (
          <div className="flex flex-col gap-1">
            {review.requesterName && <p className="text-sm font-semibold">{review.requesterName}</p>}
            {review.neededBy && <p className="text-xs text-muted-foreground">Due {review.neededBy}</p>}
            {review.targetRoles && (
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{review.targetRoles}</p>
            )}
          </div>
        )}

        {canEdit ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="overall-comments" className="text-sm font-medium">Overall comments</label>
            <Textarea
              id="overall-comments"
              rows={5}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
            />
          </div>
        ) : (
          review.feedback && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">
                Overall comments
                {review.reviewerName && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{review.reviewerName}</span>
                )}
              </h3>
              <p className="whitespace-pre-wrap text-sm">{review.feedback}</p>
            </div>
          )
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-medium">Notes</h3>
            {notes && notes.length > 0 && <span className="text-xs text-muted-foreground/60">({notes.length})</span>}
            {canEdit && (
              <InfoHint label="How to add a note" side="left">
                Click to pin a spot, drag to box an area, or select text.
              </InfoHint>
            )}
          </div>

          {canEdit && target && (
            <NoteEditor
              key={JSON.stringify(target)}
              label="New note"
              quote={target.quote}
              onSave={onAdd}
              onCancel={onCancelTarget}
            />
          )}

          {notes === null ? (
            <Skeleton className="h-14 w-full rounded-lg" />
          ) : notes.length === 0 && !target ? (
            <p className="text-xs text-muted-foreground">No notes yet.</p>
          ) : (
            notes.map((note) =>
              editingId === note.id ? (
                <NoteEditor
                  key={note.id}
                  label={`Edit note ${numbers.get(note.id)}`}
                  initial={note.body}
                  quote={note.quote}
                  onCancel={() => setEditingId(null)}
                  onSave={(body) => {
                    onUpdate(note, body);
                    setEditingId(null);
                  }}
                />
              ) : (
                <div
                  key={note.id}
                  data-note-item={note.id}
                  className={cn(
                    "group flex gap-2 rounded-lg p-2 transition-colors",
                    note.id === selectedId ? "bg-amber-500/15" : "hover:bg-foreground/[0.04]",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Show note ${numbers.get(note.id)} on the resume`}
                    onClick={() => onSelect(note.id)}
                    className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold leading-none text-black"
                  >
                    {numbers.get(note.id)}
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {note.quote && <p className="line-clamp-2 text-xs italic text-muted-foreground">{note.quote}</p>}
                    <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
                    {((canEdit && note.author_id && authors[note.author_id]) || multiPage) && (
                      <p className="text-[11px] text-muted-foreground">
                        {[multiPage ? `Page ${note.page}` : null, canEdit && note.author_id ? authors[note.author_id] : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <button
                        type="button"
                        aria-label={`Edit note ${numbers.get(note.id)}`}
                        onClick={() => setEditingId(note.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete note ${numbers.get(note.id)}`}
                        onClick={() => onDelete(note)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ),
            )
          )}
        </div>
      </ScrollArea>

      {canEdit && (
        <div className="flex shrink-0 justify-end border-t p-3">
          <button
            type="button"
            onClick={confirmSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={14} />
            Send feedback
          </button>
        </div>
      )}
    </aside>
  );
}
