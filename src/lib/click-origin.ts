// Where the last press happened, so an overlay can grow out of whatever opened
// it instead of out of the middle of the screen.
//
// Every dialog in the app opens from controlled `open` state (a button, a menu
// item, a card), never a <DialogTrigger>, so there's no trigger element to read
// a rect from. One capture-phase listener records the pointer instead; any
// keypress clears it, so a dialog opened from the keyboard grows from centre.

type Origin = { x: number; y: number; t: number };

let last: Origin | null = null;
let installed = false;

/** How old a press can be and still count as "what opened this". */
const FRESH_MS = 1000;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "pointerdown",
    (e) => {
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "keydown",
    (e) => {
      // Modifier-only presses (e.g. cmd while clicking) aren't an "open".
      if (e.key === "Shift" || e.key === "Meta" || e.key === "Control" || e.key === "Alt") return;
      last = null;
    },
    { capture: true, passive: true },
  );
}

install();

/** The last press, if it's recent enough to be what opened an overlay. */
export function recentClickOrigin(): { x: number; y: number } | null {
  if (!last || performance.now() - last.t > FRESH_MS) return null;
  return { x: last.x, y: last.y };
}

/**
 * transform-origin for a viewport-centred overlay so it scales out of the
 * press point: the element's centre is the viewport's centre, so the offset
 * from 50% is just the press's offset from the viewport middle.
 */
export function centredOriginFromClick(): string {
  const o = recentClickOrigin();
  if (!o || typeof window === "undefined") return "50% 50%";
  const dx = Math.round(o.x - window.innerWidth / 2);
  const dy = Math.round(o.y - window.innerHeight / 2);
  return `calc(50% + ${dx}px) calc(50% + ${dy}px)`;
}
