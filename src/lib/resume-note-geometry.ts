// Where a resume note sits. Every position is a fraction (0 to 1) of the page
// as displayed, measured from its top-left corner, so a note lands on the same
// spot at any zoom, screen size or pixel density. This file is pure so it can
// be tested without a browser; supabase/migrations/0112 enforces the same rules.

export type NoteKind = "point" | "box" | "text";
export type NoteRect = { x: number; y: number; w: number; h: number };
export type PageBox = { left: number; top: number; width: number; height: number };
export type ClientPoint = { x: number; y: number };
type ClientRect = { left: number; top: number; right: number; bottom: number };

/** Pointer travel below this many CSS pixels counts as a click, not a drag. */
export const DRAG_THRESHOLD = 4;

const MAX_TEXT_RECTS = 200;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function isDrag(a: ClientPoint, b: ClientPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= DRAG_THRESHOLD;
}

function span(a: number, b: number): [number, number] {
  const start = round(clamp01(Math.min(a, b)));
  return [start, Math.min(round(clamp01(Math.max(a, b)) - start), round(1 - start))];
}

function normalize(rect: ClientRect, page: PageBox): NoteRect {
  const [x, w] = span((rect.left - page.left) / page.width, (rect.right - page.left) / page.width);
  const [y, h] = span((rect.top - page.top) / page.height, (rect.bottom - page.top) / page.height);
  return { x, y, w, h };
}

export function pointRect(point: ClientPoint, page: PageBox): NoteRect {
  return normalize({ left: point.x, right: point.x, top: point.y, bottom: point.y }, page);
}

export function boxRect(a: ClientPoint, b: ClientPoint, page: PageBox): NoteRect {
  return normalize(
    { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) },
    page,
  );
}

/** Turn a text selection's rectangles into one rectangle per line of text. */
export function textRects(rects: ClientRect[], page: PageBox): NoteRect[] {
  const visible = rects
    .map((r) => normalize(r, page))
    .filter((r) => r.w > 0 && r.h > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: NoteRect[] = [];
  for (const rect of visible) {
    const line = lines[lines.length - 1];
    const overlap = line ? Math.min(line.y + line.h, rect.y + rect.h) - Math.max(line.y, rect.y) : 0;
    if (!line || overlap < Math.min(line.h, rect.h) / 2) {
      lines.push({ ...rect });
      continue;
    }
    const x = Math.min(line.x, rect.x);
    const y = Math.min(line.y, rect.y);
    const right = Math.max(line.x + line.w, rect.x + rect.w);
    const bottom = Math.max(line.y + line.h, rect.y + rect.h);
    Object.assign(line, { x, y, w: round(right - x), h: round(bottom - y) });
  }
  return lines;
}

export function isValidNoteGeometry(kind: NoteKind, rects: NoteRect[]): boolean {
  if (rects.length === 0 || rects.length > (kind === "text" ? MAX_TEXT_RECTS : 1)) return false;
  return rects.every(({ x, y, w, h }) => {
    if (![x, y, w, h].every(Number.isFinite)) return false;
    if (x < 0 || y < 0 || w < 0 || h < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return false;
    return kind === "point" ? w === 0 && h === 0 : w > 0 && h > 0;
  });
}

/** Reading order: by page, then down the page, then across. */
export function compareNotes(
  a: { page: number; rects: NoteRect[] },
  b: { page: number; rects: NoteRect[] },
): number {
  return a.page - b.page || a.rects[0].y - b.rects[0].y || a.rects[0].x - b.rects[0].x;
}
