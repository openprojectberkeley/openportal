"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  MAX_PORTAL_CONTENT,
  hasUnsavedContent,
  normalizePortalContent,
} from "@/lib/portal-content";

// SECURITY: react-markdown builds a React element tree, never an HTML string,
// and raw HTML in the source is dropped because rehype-raw is deliberately
// absent. Do NOT add rehype-raw — the author of a page is any portal admin
// (which includes every project PM) and the readers are every member of that
// portal, so it would be stored XSS. If it is ever added, rehype-sanitize
// becomes mandatory. The default urlTransform already strips javascript: and
// data: hrefs, so leave that alone too.
const MARKDOWN_COMPONENTS: Components = {
  // _blank keeps the portal open behind the link — these pages are mostly link
  // dumps. overflow-wrap stops a pasted 200-character URL widening the column.
  a: (props) => (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className="[overflow-wrap:anywhere]"
      {...props}
    />
  ),
  // Wide tables scroll inside the column instead of side-scrolling the page.
  table: (props) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

type Props = {
  portalId: string;
  // Portal admins — exec, explicit admin rows, admin-tier roles, and project
  // PMs via the rows 0013 materializes. This only decides what renders;
  // portals_update's RLS is what actually authorizes the write.
  canEdit: boolean;
  // Arrives with the portal row, so there's no separate loading state here.
  content: string | null;
  // Lifts the saved value back to the page so portal.content stays the single
  // source of truth (mirrors PortalSettingsModal's onMetaSaved).
  onSaved: (content: string | null) => void;
};

// The portal's free-form markdown page — the main column of the portal detail
// view. Read-only for members; admins toggle the same area into a textarea over
// the markdown source. Deliberately a plain textarea rather than a rich-text
// editor: the browser's native Ctrl+Z / Ctrl+Shift+Z is the entire undo story,
// and nothing here intercepts those keys.
export function PortalContent({ portalId, canEdit, content, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Losing admin mid-session (role simulation flips isAdmin) shouldn't strand
  // someone in an editor they can no longer save from.
  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  // Auto-grow so the editor is as tall as the document and the *page* scrolls,
  // matching how the rendered view behaves. Runs before paint to avoid a jump.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  const startEdit = () => {
    setDraft(content ?? "");
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    if (hasUnsavedContent(draft, content)) {
      setDiscardOpen(true);
      return;
    }
    setEditing(false);
  };

  const save = async () => {
    const next = normalizePortalContent(draft);
    if (next && next.length > MAX_PORTAL_CONTENT) {
      setError(
        `Too long — ${next.length.toLocaleString()} characters, and the limit is ${MAX_PORTAL_CONTENT.toLocaleString()}.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    // The .select() is load-bearing, not cosmetic: an update blocked by RLS
    // matches zero rows and comes back with no error, which would otherwise
    // look like a successful save. No row back means portals_update refused it.
    const { data, error: updateError } = await supabase
      .from("portals")
      .update({ content: next, updated_at: new Date().toISOString() })
      .eq("id", portalId)
      .select("content")
      .maybeSingle();
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!data) {
      setError("You don't have permission to edit this page.");
      return;
    }
    onSaved((data.content as string | null) ?? null);
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {editing ? (
        <>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write anything — notes, links, docs. Markdown is supported."
            spellCheck={false}
            // resize-none rather than resize-y: auto-grow would clobber a manual
            // drag-resize on the next keystroke anyway.
            className="border rounded-md px-3 py-2 font-mono text-sm leading-relaxed w-full min-h-[24rem] resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {canEdit && content && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1 self-end text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil size={13} /> Edit
            </button>
          )}

          {content ? (
            // max-w-none overrides prose's own ~65ch cap so tables and code can
            // use the full column; the prose-* modifiers then put a readable
            // measure back on the text itself. break-words is the last line of
            // defence against a pasted long URL.
            <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-headings:max-w-[72ch] prose-p:max-w-[72ch] prose-li:max-w-[72ch]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {content}
              </ReactMarkdown>
            </div>
          ) : canEdit ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-sm text-muted-foreground">
                Nothing here yet. Add links, notes, or anything else this portal needs.
              </p>
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil size={14} /> Add page
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          )}
        </>
      )}

      {/* Rendered outside the editing branch on purpose: confirming discard
          leaves edit mode, which would otherwise unmount this dialog from
          inside its own confirm handler. */}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard changes?"
        description="Your unsaved edits to this page will be lost."
        confirmLabel="Discard"
        onConfirm={() => {
          setError(null);
          setEditing(false);
        }}
      />
    </div>
  );
}
