"use client";

import { useMemo, useState } from "react";
import { Bell, Calendar, Check, Copy, LayoutGrid, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import s from "./glass-lab.module.css";

/*
 * /lab/glass: a scratch page for honing the glass *edge* treatment before any
 * of it ships. Not linked from the app. Each tile shows one edge variant over
 * a backdrop, all driven by the same controls, so variants can be compared
 * like for like. Pick one, tune it, copy the CSS.
 */

type VariantKey =
  | "hairline"
  | "litTop"
  | "gradientRim"
  | "doubleEdge"
  | "specular"
  | "frostedRim"
  | "innerGlow"
  | "chromatic";

const VARIANTS: { key: VariantKey; name: string; note: string; rim?: boolean }[] = [
  { key: "hairline", name: "Hairline (current)", note: "Translucent 1px ring. What floating layers use today." },
  { key: "litTop", name: "Lit top edge", note: "A bright top lip plus the hairline. Reads as light from above." },
  { key: "gradientRim", name: "Gradient rim", note: "1px rim bright toward the light angle, fading out opposite.", rim: true },
  { key: "doubleEdge", name: "Double edge", note: "Dark outer line + light inner line: separation and thickness." },
  { key: "specular", name: "Specular rim", note: "The rim catches light where your pointer is. Move over it.", rim: true },
  { key: "frostedRim", name: "Frosted rim", note: "A wider band blurred harder than the body, like ground glass.", rim: true },
  { key: "innerGlow", name: "Inner glow", note: "Hairline + light scattering down from the top inside the pane." },
  { key: "chromatic", name: "Chromatic rim", note: "Logo colours, faint, as the rim. Tests the no-rainbow rule.", rim: true },
];

type Backdrop = "portals" | "blobs" | "stripes" | "plain";
type Sample = "menu" | "card" | "dock";

type Params = {
  blur: number;
  sat: number;
  alpha: number;
  edge: number;
  hi: number;
  radius: number;
  angle: number;
  rim: number;
};

const DEFAULTS: Params = { blur: 20, sat: 1.8, alpha: 0.7, edge: 0.09, hi: 0.35, radius: 12, angle: 160, rim: 6 };

const CONTROLS: { key: keyof Params; label: string; min: number; max: number; step: number; unit?: string }[] = [
  { key: "blur", label: "Blur", min: 0, max: 48, step: 1, unit: "px" },
  { key: "sat", label: "Saturation", min: 1, max: 2.5, step: 0.05 },
  { key: "alpha", label: "Surface opacity", min: 0.2, max: 1, step: 0.01 },
  { key: "edge", label: "Edge strength", min: 0, max: 0.4, step: 0.01 },
  { key: "hi", label: "Highlight", min: 0, max: 0.9, step: 0.01 },
  { key: "radius", label: "Radius", min: 4, max: 28, step: 1, unit: "px" },
  { key: "angle", label: "Light angle", min: 0, max: 360, step: 5, unit: "°" },
  { key: "rim", label: "Frosted rim width", min: 2, max: 16, step: 1, unit: "px" },
];

function vars(p: Params): React.CSSProperties {
  return {
    "--g-blur": `${p.blur}px`,
    "--g-sat": p.sat,
    "--g-alpha": p.alpha,
    "--g-edge": p.edge,
    "--g-hi": p.hi,
    "--g-radius": `${p.radius}px`,
    "--g-angle": `${p.angle}deg`,
    "--g-rim": `${p.rim}px`,
  } as React.CSSProperties;
}

/** The CSS to paste for the chosen variant, with the current numbers baked in. */
function cssFor(v: VariantKey, p: Params): string {
  const base = `.glass {
  border-radius: ${p.radius}px;
  background-color: hsl(var(--popover) / ${p.alpha});
  backdrop-filter: blur(${p.blur}px) saturate(${p.sat});`;
  const ring = `
  position: relative;
}
.glass::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: ${v === "frostedRim" ? `${p.rim}px` : "1px"};
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  pointer-events: none;`;
  switch (v) {
    case "hairline":
      return `${base}\n  box-shadow: inset 0 0 0 1px hsl(var(--foreground) / ${p.edge});\n}`;
    case "litTop":
      return `${base}\n  box-shadow:\n    inset 0 1px 0 0 hsl(0 0% 100% / ${p.hi}),\n    inset 0 0 0 1px hsl(var(--foreground) / ${p.edge});\n}`;
    case "doubleEdge":
      return `${base}\n  box-shadow:\n    0 0 0 1px hsl(var(--foreground) / ${+(p.edge * 1.4).toFixed(3)}),\n    inset 0 0 0 1px hsl(0 0% 100% / ${p.hi});\n}`;
    case "innerGlow":
      return `${base}\n  box-shadow:\n    inset 0 0 0 1px hsl(var(--foreground) / ${p.edge}),\n    inset 0 1px 0 0 hsl(0 0% 100% / ${p.hi}),\n    inset 0 18px 24px -20px hsl(0 0% 100% / ${+(p.hi * 0.9).toFixed(3)});\n}`;
    case "gradientRim":
      return `${base}${ring}\n  background: linear-gradient(${p.angle}deg, hsl(0 0% 100% / ${p.hi}) 0%, transparent 45%, transparent 70%, hsl(0 0% 100% / ${+(p.hi * 0.35).toFixed(3)}) 100%);\n}`;
    case "specular":
      return `${base}${ring}\n  /* --mx/--my set from pointermove on the element */\n  background:\n    radial-gradient(180px circle at var(--mx) var(--my), hsl(0 0% 100% / ${+(p.hi * 2).toFixed(3)}), transparent 70%),\n    hsl(var(--foreground) / ${p.edge});\n}`;
    case "frostedRim":
      return `${base}${ring}\n  background: hsl(0 0% 100% / ${+(p.hi * 0.5).toFixed(3)});\n  backdrop-filter: blur(${p.blur * 2}px) saturate(${+(p.sat * 1.2).toFixed(2)});\n}`;
    case "chromatic":
      return `${base}${ring}\n  background: conic-gradient(from ${p.angle}deg, /* logo hues at ${p.hi} alpha */ ...);\n}`;
  }
}

// Fake dashboard content to sit behind the glass: portal-card-like blocks in
// real accent colours, so the glass is judged over what it'll actually cover.
const PORTAL_SWATCHES = ["#B0213E", "#E8B931", "#3A6FD8", "#1FA88A", "#7B2FF7", "#F97316"];

function BackdropFill({ kind }: { kind: Backdrop }) {
  if (kind === "blobs") return <div className={cn("absolute inset-0", s.backdropBlobs)} />;
  if (kind === "stripes") return <div className={cn("absolute inset-0", s.backdropStripes)} />;
  if (kind === "plain") return <div className="absolute inset-0 bg-background" />;
  return (
    <div className="absolute inset-0 grid grid-cols-2 gap-2 bg-background p-2">
      {PORTAL_SWATCHES.map((c) => (
        <div key={c} className="relative overflow-hidden rounded-lg bg-muted p-2">
          <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: c }} />
          <div className="ml-2 flex items-center gap-2">
            <span className="h-5 w-5 rounded-md" style={{ backgroundColor: c }} />
            <span className="h-2 w-12 rounded-full bg-foreground/30" />
          </div>
          <div className="ml-2 mt-2 h-1.5 w-20 rounded-full bg-foreground/15" />
        </div>
      ))}
    </div>
  );
}

function SampleBody({ kind }: { kind: Sample }) {
  if (kind === "dock") {
    return (
      <div className="flex items-center gap-1 p-1.5 text-xs">
        <span className="px-2 text-muted-foreground">View as</span>
        <span className="rounded-full px-2 py-1">Member</span>
        <span className="rounded-full px-2 py-1">PM</span>
        <span className="rounded-full bg-foreground px-2 py-1 text-background">Exec</span>
      </div>
    );
  }
  if (kind === "card") {
    return (
      <div className="flex w-56 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <Bell size={14} />
          <span className="text-sm font-semibold">Notifications</span>
        </div>
        <p className="text-xs text-muted-foreground">Hackathon submissions close tonight at 11:59pm.</p>
        <p className="text-xs text-muted-foreground">Starlings lead by 12 points.</p>
      </div>
    );
  }
  return (
    <div className="flex w-48 flex-col p-1 text-sm">
      {[
        { icon: LayoutGrid, label: "Members" },
        { icon: Calendar, label: "Attendance", active: true },
        { icon: Trophy, label: "Scoreboard" },
      ].map(({ icon: Icon, label, active }) => (
        <div key={label} className={cn("flex items-center gap-2 rounded-sm px-2 py-1.5", active && "bg-accent")}>
          <Icon size={14} className="text-muted-foreground" />
          {label}
        </div>
      ))}
    </div>
  );
}

function GlassTile({
  variant,
  backdrop,
  sample,
  selected,
  onSelect,
  large = false,
}: {
  variant: (typeof VARIANTS)[number];
  backdrop: Backdrop;
  sample: Sample;
  selected?: boolean;
  onSelect?: () => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        !large && "p-2 hover:bg-foreground/[0.03]",
        selected && !large && "bg-foreground/[0.05]",
      )}
    >
      <div className={cn("relative flex items-center justify-center overflow-hidden rounded-lg", large ? "h-80" : "h-48")}>
        <BackdropFill kind={backdrop} />
        <div
          className={cn(s.glass, variant.rim && s.rim, s[variant.key], "shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]")}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
            e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
          }}
        >
          <SampleBody kind={sample} />
        </div>
      </div>
      {!large && (
        <div className="px-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {selected && <Check size={14} />}
            {variant.name}
          </div>
          <p className="text-xs text-muted-foreground">{variant.note}</p>
        </div>
      )}
    </button>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium",
            value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function GlassLabPage() {
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [backdrop, setBackdrop] = useState<Backdrop>("portals");
  const [sample, setSample] = useState<Sample>("menu");
  const [picked, setPicked] = useState<VariantKey>("litTop");
  const [copied, setCopied] = useState(false);
  const pickedVariant = VARIANTS.find((v) => v.key === picked)!;
  const css = useMemo(() => cssFor(picked, params), [picked, params]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-5" style={vars(params)}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Glass edge lab</h1>
        <p className="text-sm text-muted-foreground">
          Scratch page, not linked anywhere. Nothing here ships until a variant is picked.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Controls */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:w-72 lg:shrink-0 lg:self-start">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Behind</span>
            <Segmented
              value={backdrop}
              onChange={setBackdrop}
              options={[
                { value: "portals", label: "Portals" },
                { value: "blobs", label: "Colour" },
                { value: "stripes", label: "Stripes" },
                { value: "plain", label: "Plain" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sample</span>
            <Segmented
              value={sample}
              onChange={setSample}
              options={[
                { value: "menu", label: "Menu" },
                { value: "card", label: "Popover" },
                { value: "dock", label: "Dock" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-3 rounded-xl surface p-4">
            {CONTROLS.map((c) => (
              <label key={c.key} className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-mono">
                    {params[c.key]}
                    {c.unit ?? ""}
                  </span>
                </span>
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={params[c.key]}
                  onChange={(e) => setParams((p) => ({ ...p, [c.key]: Number(e.target.value) }))}
                  className="accent-foreground"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => setParams(DEFAULTS)}
              className="self-start text-xs text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
        </aside>

        {/* Stage */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold tracking-tight">{pickedVariant.name}</h2>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(css).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.06] px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/[0.1]"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy CSS"}
              </button>
            </div>
            <GlassTile variant={pickedVariant} backdrop={backdrop} sample={sample} large />
            <pre className="overflow-x-auto rounded-lg surface p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {css}
            </pre>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold tracking-tight">All variants</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {VARIANTS.map((v) => (
                <GlassTile
                  key={v.key}
                  variant={v}
                  backdrop={backdrop}
                  sample={sample}
                  selected={picked === v.key}
                  onSelect={() => setPicked(v.key)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
