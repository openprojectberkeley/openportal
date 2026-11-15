"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { createBlobSim, type BlobFeed, type BlobSim } from "@/lib/blob-sim";

/**
 * A liquid blob that inverts whatever sits under it.
 *
 * Mount it as the last child of a `relative isolate` container: it covers the
 * container with a canvas, listens to the pointer there, and blends with
 * `difference`, so the white liquid flips the background, artwork and text
 * beneath to their negative.
 *
 * The liquid is the Open Project website's hero blob (see lib/blob-sim): a
 * fluid simulation the pointer feeds along its whole path. It follows the
 * pointer thin and calm on a slow drift, swells and splashes on a fast stroke,
 * keeps churning after the pointer stops, then drains away.
 *
 * Only for a fine, hovering pointer with motion allowed, and only where WebGL2
 * can run it; otherwise it renders nothing. The loop runs only while there is
 * liquid to draw.
 */

/*
 * How a stroke's speed becomes what it feeds in, as on the website's trail
 * (~/frontend/src/components/pixelTrail.js):
 *
 *   MIN_REACH / REACH  the stroke's reach at rest and at full stride, in px
 *   FULL_SPEED         the pointer speed that earns the full reach, in px/ms
 *   RAMP               how long a stroke must keep going before it can reach that
 *                      far, in ms, so even a flick starts thin
 *   PAUSE              a gap between moves longer than this, in ms, ends the
 *                      stroke and the next one starts thin again
 *   MIN_STRENGTH       how much of the reach a stroke needs before it pushes the
 *                      fluid about at all. Below it the blob only follows the
 *                      pointer, thin and calm
 */
const MIN_REACH = 14;
const REACH = 80;
const FULL_SPEED = 1.4;
const RAMP = 450;
const PAUSE = 150;
const MIN_STRENGTH = 0.5;
/** Canvas pixels per CSS px, at most: sharp edges without drawing 9x the pixels. */
const MAX_DENSITY = 2;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const QUERY = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getSnapshot = () => window.matchMedia(QUERY).matches;
const getServerSnapshot = () => false;

export function InvertBlob() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return enabled ? <Liquid /> : null;
}

function Liquid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    let blob: BlobSim | null = null;
    let blobTried = false;
    let frame = 0;
    /** The pointer's path since the last frame, in client px. */
    let path: BlobFeed | null = null;
    let lastMove: { x: number; y: number; t: number } | null = null;
    let strokeStart = 0;
    let speed = 0;

    /* How far a move reaches comes from the stroke so far, not the one event:
       the pointer's speed, smoothed so one jittery report can't throw out a
       blot, times how long the stroke has been going. */
    const reachFor = (now: number, distance: number, elapsed: number) => {
      if (!lastMove || elapsed > PAUSE) {
        strokeStart = now;
        speed = 0;
      } else if (elapsed > 0) {
        speed += (distance / elapsed - speed) * (1 - Math.exp(-elapsed / 80));
      }
      const stride = smoothstep(Math.sqrt(speed / FULL_SPEED));
      const ramp = smoothstep((now - strokeStart) / RAMP);
      return MIN_REACH + (REACH - MIN_REACH) * stride * ramp;
    };

    const tick = (now: number) => {
      frame = 0;

      if (!path && !(blob && blob.active(now))) {
        blob?.clear();
        return;
      }

      frame = requestAnimationFrame(tick);

      /* Not until the pointer first moves, so a page nobody touches sets
         nothing up on the GPU. */
      if (!blobTried) {
        blobTried = true;
        blob = createBlobSim(canvas);
      }

      const rect = canvas.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, MAX_DENSITY);

      if (blob && blob.resize(rect.width, rect.height, density)) {
        if (path) {
          blob.feed(
            {
              ...path,
              fromX: path.fromX - rect.left,
              fromY: path.fromY - rect.top,
              toX: path.toX - rect.left,
              toY: path.toY - rect.top,
            },
            now,
          );
        }
        blob.advance(now);
        blob.render(now);
      }

      path = null;
    };

    /* Adds this move to the path the next frame feeds in, however many moves
       the pointer reports in a frame. */
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;

      const now = performance.now();
      const x = event.clientX;
      const y = event.clientY;
      const previous = lastMove;
      const distance = previous ? Math.hypot(x - previous.x, y - previous.y) : 0;
      const elapsed = previous ? now - previous.t : Infinity;
      const reach = reachFor(now, distance, elapsed);

      lastMove = { x, y, t: now };

      if (previous && now > previous.t && now - previous.t <= PAUSE) {
        const strength = clamp01((reach - MIN_REACH) / (REACH - MIN_REACH));
        const power = smoothstep((strength - MIN_STRENGTH) / (1 - MIN_STRENGTH));

        path = {
          fromX: path ? path.fromX : previous.x,
          fromY: path ? path.fromY : previous.y,
          toX: x,
          toY: y,
          elapsed: (path ? path.elapsed : 0) + now - previous.t,
          body: strength,
          power,
        };
      }

      if (!frame) frame = requestAnimationFrame(tick);
    };

    /* The pointer has gone: the next stroke starts afresh, and what is already
       in the blob finishes on its own. */
    const onLeave = () => {
      lastMove = null;
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      blob?.clear();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 h-full w-full mix-blend-difference"
    />
  );
}
