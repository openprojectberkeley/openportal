"use client";

import { useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils";

import styles from "./floating-mark.module.css";

/** The logo's own canvas (src/assets/icon.svg); all three layers share it. */
const VIEW_BOX = "0 0 1875 2170";

/*
 * How each shape answers the cursor, bowl → stem → hook (back to front):
 *
 *   origin     the shape's centre in the shared box, as fractions; it is what
 *              the shape is pushed away from, and what it turns about
 *   depth      inverse parallax, in px: how far the shape slides the other way
 *              as the cursor crosses the panel from centre to edge. Nearer
 *              layers slide further, so the mark reads as layered in depth
 *   repel      how far the shape is shoved away from a cursor right on top of
 *              it, in px, easing off to nothing at REPEL_RADIUS
 *   stiffness  the spring pulling the shape to where it should be, per 60fps
 *              frame. Softer at the back, so the layers lag one another
 */
const LAYERS = [
  { origin: [0.367, 0.317], depth: 10, repel: 16, stiffness: 0.022 },
  { origin: [0.367, 0.745], depth: 16, repel: 22, stiffness: 0.03 },
  { origin: [0.71, 0.54], depth: 24, repel: 28, stiffness: 0.038 },
] as const;
const REPEL_RADIUS = 300;
/** Share of the spring's velocity kept each 60fps frame: a little overshoot. */
const DAMPING = 0.86;
/** Degrees of lean per px of horizontal offset, so a push reads as a tilt. */
const LEAN = 0.08;

const QUERY = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

/**
 * The Open Portal mark taken apart: bowl, stem and hook as three stacked
 * SVGs over one shared 1875x2170 box, so at rest they compose the exact logo.
 *
 * Two motions add up on each shape. Its own slow drift loop
 * (floating-mark.module.css), so the mark hangs in space. And a sprung offset
 * from the cursor, wherever it is in the mark's container: each layer slides
 * against the cursor by its own depth, and shies away when the cursor comes
 * close. The springs settle at different speeds, so the pieces trail one
 * another. Reduced motion holds them still; without a hovering pointer only
 * the drift runs.
 */
export function FloatingMark({ className }: { className?: string }) {
  const uid = useId();
  const bowl = `${uid}-bowl`;
  const stem = `${uid}-stem`;
  const hook = `${uid}-hook`;
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    const host = root?.parentElement;
    if (!root || !host || !window.matchMedia(QUERY).matches) return;

    const n = LAYERS.length;
    const pos = LAYERS.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 }));
    let raf = 0;
    let last = 0;

    const aim = (clientX: number, clientY: number) => {
      const hostRect = host.getBoundingClientRect();
      const markRect = root.getBoundingClientRect();
      // -1..1 across the panel, from its centre.
      const nx = ((clientX - hostRect.left) / hostRect.width) * 2 - 1;
      const ny = ((clientY - hostRect.top) / hostRect.height) * 2 - 1;

      for (let i = 0; i < n; i++) {
        const { origin, depth, repel } = LAYERS[i];
        let tx = -nx * depth;
        let ty = -ny * depth;

        const cx = markRect.left + origin[0] * markRect.width;
        const cy = markRect.top + origin[1] * markRect.height;
        const dx = cx - clientX;
        const dy = cy - clientY;
        const dist = Math.hypot(dx, dy);
        if (dist < REPEL_RADIUS && dist > 0.5) {
          const falloff = 1 - dist / REPEL_RADIUS;
          const push = repel * falloff * falloff;
          tx += (dx / dist) * push;
          ty += (dy / dist) * push;
        }

        pos[i].tx = tx;
        pos[i].ty = ty;
      }
    };

    const tick = (now: number) => {
      // Fixed 60fps substeps, so the springs feel the same at any frame rate.
      const steps = last ? Math.min(Math.round((now - last) / (1000 / 60)), 4) : 1;
      last = now;

      let settled = true;
      for (let i = 0; i < n; i++) {
        const p = pos[i];
        const k = LAYERS[i].stiffness;
        for (let s = 0; s < steps; s++) {
          p.vx = (p.vx + (p.tx - p.x) * k) * DAMPING;
          p.vy = (p.vy + (p.ty - p.y) * k) * DAMPING;
          p.x += p.vx;
          p.y += p.vy;
        }
        if (
          Math.abs(p.tx - p.x) > 0.05 ||
          Math.abs(p.ty - p.y) > 0.05 ||
          Math.abs(p.vx) > 0.01 ||
          Math.abs(p.vy) > 0.01
        ) {
          settled = false;
        }
        const el = layerRefs.current[i];
        if (el) {
          el.style.transform = `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) rotate(${(p.x * LEAN).toFixed(3)}deg)`;
        }
      }

      if (settled) {
        raf = 0;
        last = 0;
      } else {
        raf = requestAnimationFrame(tick);
      }
    };

    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      aim(e.clientX, e.clientY);
      wake();
    };
    const onLeave = () => {
      for (const p of pos) {
        p.tx = 0;
        p.ty = 0;
      }
      wake();
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  const layer = (i: number) => ({
    ref: (el: HTMLDivElement | null) => {
      layerRefs.current[i] = el;
    },
    className: styles.layer,
    style: {
      transformOrigin: `${LAYERS[i].origin[0] * 100}% ${LAYERS[i].origin[1] * 100}%`,
    },
  });

  return (
    <div
      ref={rootRef}
      aria-hidden
      className={cn("relative aspect-[1875/2170] select-none", className)}
    >
      <div {...layer(0)}>
        <svg
          viewBox={VIEW_BOX}
          fill="none"
          focusable="false"
          className={cn(styles.shape, styles.bowl)}
        >
          <defs>
            <linearGradient
              id={bowl}
              x1="687.925"
              y1="0"
              x2="687.925"
              y2="1375.85"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#6E1FC2" className={styles.bowlFrom} />
              <stop offset="1" stopColor="#68E2C3" className={styles.bowlTo} />
            </linearGradient>
          </defs>
          <circle cx="687.925" cy="687.925" r="687.925" fill={`url(#${bowl})`} />
        </svg>
      </div>

      <div {...layer(1)}>
        <svg
          viewBox={VIEW_BOX}
          fill="none"
          focusable="false"
          className={cn(styles.shape, styles.stem)}
        >
          <defs>
            <linearGradient
              id={stem}
              x1="687.878"
              y1="1065.76"
              x2="687.878"
              y2="2169.42"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#F9D85D" className={styles.stemFrom} />
              <stop offset="1" stopColor="#6EE978" className={styles.stemTo} />
            </linearGradient>
          </defs>
          <rect
            x="484.797"
            y="1065.76"
            width="406.163"
            height="1103.66"
            rx="99.4799"
            fill={`url(#${stem})`}
          />
        </svg>
      </div>

      <div {...layer(2)}>
        <svg
          viewBox={VIEW_BOX}
          fill="none"
          focusable="false"
          className={cn(styles.shape, styles.hook)}
        >
          <defs>
            <linearGradient
              id={hook}
              x1="1287.34"
              y1="655.761"
              x2="1634.91"
              y2="1629.45"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#EB50A1" className={styles.hookFrom} />
              <stop offset="1" stopColor="#FF910E" className={styles.hookTo} />
            </linearGradient>
          </defs>
          <path
            d="M1006.9 759.922C1262.57 656.068 1542.92 766.215 1646.91 1021.87C1750.9 1277.52 1639.16 1581.86 1383.49 1685.71"
            strokeWidth="265.28"
            strokeLinecap="round"
            stroke={`url(#${hook})`}
          />
        </svg>
      </div>
    </div>
  );
}
