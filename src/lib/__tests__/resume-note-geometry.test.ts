import { describe, expect, it } from "vitest";
import {
  boxRect,
  compareNotes,
  isDrag,
  isValidNoteGeometry,
  pointRect,
  textRects,
} from "@/lib/resume-note-geometry";

const page = { left: 100, top: 50, width: 400, height: 800 };

describe("resume note geometry", () => {
  it("stores a click as a page fraction", () => {
    expect(pointRect({ x: 300, y: 250 }, page)).toEqual({ x: 0.5, y: 0.25, w: 0, h: 0 });
  });

  it("gives the same position at any zoom", () => {
    const zoomed = { left: 20, top: 10, width: 800, height: 1600 };
    expect(pointRect({ x: 420, y: 410 }, zoomed)).toEqual(pointRect({ x: 300, y: 250 }, page));
  });

  it("handles a landscape (rotated) page box", () => {
    const rotated = { left: 0, top: 0, width: 1100, height: 850 };
    expect(boxRect({ x: 1100, y: 850 }, { x: 550, y: 425 }, rotated)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("clamps positions dragged outside the page", () => {
    expect(boxRect({ x: 0, y: 0 }, { x: 900, y: 1000 }, page)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(pointRect({ x: 9999, y: -10 }, page)).toEqual({ x: 1, y: 0, w: 0, h: 0 });
  });

  it("merges selection fragments into one rectangle per line", () => {
    const rects = textRects(
      [
        { left: 100, right: 200, top: 50, bottom: 70 },
        { left: 200, right: 300, top: 51, bottom: 69 },
        { left: 100, right: 150, top: 90, bottom: 110 },
        { left: 120, right: 120, top: 90, bottom: 110 },
      ],
      page,
    );
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 0.5 });
    expect(rects[1]).toMatchObject({ x: 0, y: 0.05, w: 0.125 });
  });

  it("uses a small threshold to separate clicks from drags", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it("rejects geometry that doesn't fit its note type", () => {
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(isValidNoteGeometry("box", [box])).toBe(true);
    expect(isValidNoteGeometry("point", [box])).toBe(false);
    expect(isValidNoteGeometry("box", [box, box])).toBe(false);
    expect(isValidNoteGeometry("text", [])).toBe(false);
    expect(isValidNoteGeometry("box", [{ ...box, x: 0.9 }])).toBe(false);
    expect(isValidNoteGeometry("box", [{ ...box, y: Number.NaN }])).toBe(false);
  });

  it("sorts notes in reading order", () => {
    const at = (page: number, x: number, y: number) => ({ page, rects: [{ x, y, w: 0, h: 0 }] });
    const sorted = [at(2, 0, 0), at(1, 0.5, 0.2), at(1, 0.1, 0.2), at(1, 0.9, 0.1)].sort(compareNotes);
    expect(sorted).toEqual([at(1, 0.9, 0.1), at(1, 0.1, 0.2), at(1, 0.5, 0.2), at(2, 0, 0)]);
  });
});
