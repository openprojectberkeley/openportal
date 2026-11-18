"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  boxRect,
  isDrag,
  pointRect,
  textRects,
  type ClientPoint,
  type NoteRect,
} from "@/lib/resume-note-geometry";
import type { NoteTarget, ResumeNote } from "@/lib/use-resume-review";
import { cn } from "@/lib/utils";

const MAX_QUOTE = 2000;

const place = (r: NoteRect): CSSProperties => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.w * 100}%`,
  height: `${r.h * 100}%`,
});

const isTextTarget = (el: Element) => Boolean(el.closest(".textLayer span"));

/** The current selection, limited to this page's text. */
function readSelection(pageEl: HTMLElement): { rects: NoteRect[]; quote: string } | null {
  const selection = window.getSelection();
  const layer = pageEl.querySelector(".textLayer");
  if (!selection || selection.isCollapsed || !selection.rangeCount || !layer) return null;

  const range = selection.getRangeAt(0).cloneRange();
  if (!range.intersectsNode(layer)) return null;
  const bounds = document.createRange();
  bounds.selectNodeContents(layer);
  if (range.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    range.setStart(bounds.startContainer, bounds.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    range.setEnd(bounds.endContainer, bounds.endOffset);
  }

  // Measure text nodes only: element boxes include the layer's invisible filler.
  const clientRects: DOMRect[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    clientRects.push(...part.getClientRects());
  }

  const rects = textRects(clientRects, pageEl.getBoundingClientRect()).slice(0, 200);
  const quote = range.toString().replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE);
  return rects.length && quote ? { rects, quote } : null;
}

function Mark({
  kind,
  rects,
  label,
  selected,
  draft,
  noteId,
  onSelect,
}: Pick<NoteTarget, "kind" | "rects"> & {
  label: string;
  selected?: boolean;
  draft?: boolean;
  noteId?: string;
  onSelect?: () => void;
}) {
  const first = rects[0];
  const Badge = onSelect ? "button" : "span";
  return (
    <>
      {kind === "text" &&
        rects.map((r, i) => (
          <span
            key={i}
            style={place(r)}
            className={cn("absolute mix-blend-multiply", selected || draft ? "bg-amber-400/80" : "bg-amber-300/55")}
          />
        ))}
      {kind === "box" && (
        <span
          style={place(first)}
          className={cn(
            "absolute rounded-[2px] border-2 border-amber-500",
            draft && "border-dashed",
            selected ? "bg-amber-400/25" : "bg-amber-300/10",
          )}
        />
      )}
      {kind === "point" && (
        <span
          style={place(first)}
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-amber-600"
        />
      )}
      <Badge
        {...(onSelect ? { type: "button" as const, onClick: onSelect, "aria-label": `Note ${label}` } : {})}
        data-note-mark={noteId ?? ""}
        style={{ left: `${first.x * 100}%`, top: `${first.y * 100}%` }}
        className={cn(
          "absolute z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold leading-none text-black shadow-sm",
          kind === "point" ? "translate-x-1 -translate-y-full" : "-translate-x-1/2 -translate-y-1/2",
          onSelect && "pointer-events-auto cursor-pointer",
          selected && "ring-2 ring-black/70",
        )}
      >
        {label}
      </Badge>
    </>
  );
}

/** Draws a page's notes and, for reviewers, turns gestures into new ones. */
export function NoteLayer({
  page,
  notes,
  numbers,
  selectedId,
  target,
  canAnnotate,
  onSelect,
  onTarget,
}: {
  page: number;
  notes: ResumeNote[];
  numbers: Map<string, number>;
  selectedId: string | null;
  target: NoteTarget | null;
  canAnnotate: boolean;
  onSelect: (id: string) => void;
  onTarget: (target: NoteTarget) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [dragBox, setDragBox] = useState<NoteRect | null>(null);
  const onTargetRef = useRef(onTarget);
  useEffect(() => {
    onTargetRef.current = onTarget;
  }, [onTarget]);

  useEffect(() => {
    const pageEl = layerRef.current?.parentElement;
    if (!canAnnotate || !pageEl) return;
    pageEl.style.cursor = "crosshair";

    // Only drags that begin on text may start a browser selection.
    const onMouseDown = (e: MouseEvent) => {
      const el = e.target as Element;
      if (!isTextTarget(el) && !el.closest("[data-note-mark]")) e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element;
      if (e.button !== 0 || el.closest("[data-note-mark]")) return;

      const start: ClientPoint = { x: e.clientX, y: e.clientY };
      const touch = e.pointerType === "touch";
      const onText = !touch && isTextTarget(el);
      if (!touch && !onText) window.getSelection()?.removeAllRanges();

      const pointAt = (ev: PointerEvent): ClientPoint => ({ x: ev.clientX, y: ev.clientY });
      const onMove = (ev: PointerEvent) => {
        if (touch || onText || !isDrag(start, pointAt(ev))) return;
        setDragBox(boxRect(start, pointAt(ev), pageEl.getBoundingClientRect()));
      };
      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", stop);
        setDragBox(null);
      };
      const onUp = (ev: PointerEvent) => {
        stop();
        const end = pointAt(ev);
        const moved = isDrag(start, end);
        const box = pageEl.getBoundingClientRect();
        if (!moved) {
          onTargetRef.current({ page, kind: "point", rects: [pointRect(start, box)], quote: null });
        } else if (onText) {
          const selected = readSelection(pageEl);
          if (!selected) return;
          window.getSelection()?.removeAllRanges();
          onTargetRef.current({ page, kind: "text", rects: selected.rects, quote: selected.quote });
        } else if (!touch) {
          const rect = boxRect(start, end, box);
          if (rect.w > 0 && rect.h > 0) onTargetRef.current({ page, kind: "box", rects: [rect], quote: null });
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", stop);
    };

    pageEl.addEventListener("mousedown", onMouseDown);
    pageEl.addEventListener("pointerdown", onPointerDown);
    return () => {
      pageEl.style.cursor = "";
      pageEl.removeEventListener("mousedown", onMouseDown);
      pageEl.removeEventListener("pointerdown", onPointerDown);
    };
  }, [canAnnotate, page]);

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[5]">
      {notes.map((note) => (
        <Mark
          key={note.id}
          kind={note.kind}
          rects={note.rects}
          noteId={note.id}
          label={String(numbers.get(note.id) ?? "")}
          selected={note.id === selectedId}
          onSelect={() => onSelect(note.id)}
        />
      ))}
      {target?.page === page && <Mark kind={target.kind} rects={target.rects} label="+" draft />}
      {dragBox && <span style={place(dragBox)} className="absolute border-2 border-dashed border-amber-500 bg-amber-300/10" />}
    </div>
  );
}
