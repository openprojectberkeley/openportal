"use client";

import { useId } from "react";

// The default portal mark (a glossy "P") shown when a portal has no uploaded
// image and no emoji. The source art is solid white; here the gradient stops use
// `currentColor` so the mark inherits the surrounding text color and stays
// visible in both themes and on any backing (accent tile, muted list row, plain
// header). The white→50%-opacity gloss is preserved. Gradient ids are namespaced
// per instance (useId) so multiple marks on a page don't collide.
export function PortalDefaultIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const uid = useId();
  const g0 = `${uid}-bowl`;
  const g2 = `${uid}-stem`;
  const g4 = `${uid}-hook`;

  return (
    <svg
      viewBox="0 0 148 171"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="54.1503" cy="54.1503" r="54.1343" fill={`url(#${g0})`} />
      <rect
        x="38.1772"
        y="83.9106"
        width="31.9392"
        height="86.8428"
        rx="7.81457"
        fill={`url(#${g2})`}
      />
      <path
        d="M79.2584 59.8166C99.3836 51.6417 121.451 60.312 129.637 80.4356C137.823 100.559 129.027 124.516 108.902 132.691"
        stroke={`url(#${g4})`}
        strokeWidth="20.8816"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id={g0} x1="54.1503" y1="0" x2="54.1503" y2="108.301" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={g2} x1="54.1468" y1="83.8945" x2="54.1468" y2="170.769" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={g4} x1="101.333" y1="51.6175" x2="128.692" y2="128.262" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
        </linearGradient>
      </defs>
    </svg>
  );
}
