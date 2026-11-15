"use client";

import { useMemo, useState } from "react";
import { Bell, Calendar, Check, Copy, LayoutGrid, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/*
 * /lab/tint: a scratch page for tuning a slight base tint and one accent
 * colour per theme before any of it ships. Not linked from the app. Each
 * preview overrides the theme's CSS variables on its own wrapper, so the real
 * components (Button, Input, Switch, Segmented) render with the candidate
 * palette. Pick values, then "Copy CSS" for the globals.css blocks.
 */

type Theme = {
  hue: number; // base tint hue
  sat: number; // base tint saturation (%)
  light: number; // background lightness (%)
  accentHue: number;
  accentSat: number;
  accentLight: number;
};

type Uses = { primary: boolean; ring: boolean; selection: boolean; links: boolean; nav: boolean };

// What globals.css ships today.
const CURRENT: { dark: Theme; light: Theme } = {
  dark: { hue: 228, sat: 30, light: 6, accentHue: 9, accentSat: 90, accentLight: 56 },
  light: { hue: 40, sat: 33, light: 97, accentHue: 238, accentSat: 36, accentLight: 47 },
};

const PRESETS: { name: string; dark: Theme; light: Theme }[] = [
  { name: "Current", ...CURRENT },
  {
    name: "Navy + ember / cream + periwinkle",
    dark: { hue: 222, sat: 22, light: 6, accentHue: 16, accentSat: 88, accentLight: 58 },
    light: { hue: 40, sat: 38, light: 97, accentHue: 238, accentSat: 32, accentLight: 50 },
  },
  {
    name: "Slate + coral / linen + iris",
    dark: { hue: 215, sat: 16, light: 7, accentHue: 8, accentSat: 78, accentLight: 62 },
    light: { hue: 34, sat: 30, light: 96.5, accentHue: 255, accentSat: 28, accentLight: 48 },
  },
  {
    name: "Ink + amber / paper + denim",
    dark: { hue: 228, sat: 26, light: 5, accentHue: 28, accentSat: 92, accentLight: 56 },
    light: { hue: 45, sat: 45, light: 97.5, accentHue: 222, accentSat: 30, accentLight: 44 },
  },
];

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Full set of theme variables for one theme, as `--name: H S% L%` strings. */
function themeVars(t: Theme, dark: boolean, uses: Uses): Record<string, string> {
  const h = t.hue;
  const s = t.sat;
  const hsl = (sat: number, l: number) => `${h} ${r1(clamp(sat, 0, 100))}% ${r1(clamp(l, 0, 100))}%`;
  const brand = `${t.accentHue} ${t.accentSat}% ${t.accentLight}%`;
  const brandFg = t.accentLight > 60 ? `${t.accentHue} 40% 10%` : `${t.accentHue} 30% 98%`;
  const base: Record<string, string> = dark
    ? {
        "--background": hsl(s, t.light),
        "--foreground": hsl(Math.min(s, 20), 96),
        "--card": hsl(s * 0.86, t.light + 2.5),
        "--popover": hsl(s * 0.86, t.light + 3),
        "--muted": hsl(s * 0.72, t.light + 5.5),
        "--muted-foreground": hsl(s * 0.55, 64),
        "--secondary": hsl(s * 0.72, t.light + 8),
        "--accent": hsl(s * 0.72, t.light + 9),
        "--border": hsl(Math.min(s * 1.6, 30), 92),
        "--border-alpha": "0.075",
        "--input": hsl(Math.min(s * 1.6, 30), 92),
        "--input-alpha": "0.12",
        "--primary": hsl(Math.min(s, 20), 96),
        "--primary-foreground": hsl(s, t.light + 3),
        "--ring": hsl(s * 0.7, 72),
      }
    : {
        "--background": hsl(s, t.light),
        "--foreground": hsl(s * 0.6, 12),
        "--card": hsl(s * 1.15, Math.min(t.light + 2, 99.5)),
        "--popover": hsl(s * 1.15, Math.min(t.light + 2, 99.5)),
        "--muted": hsl(s * 0.8, t.light - 3),
        "--muted-foreground": hsl(s * 0.4, 44),
        "--secondary": hsl(s * 0.8, t.light - 3.5),
        "--accent": hsl(s * 0.9, t.light - 5),
        "--border": hsl(Math.min(s * 1.5, 30), 20),
        "--border-alpha": "0.09",
        "--input": hsl(Math.min(s * 1.5, 30), 20),
        "--input-alpha": "0.16",
        "--primary": hsl(s * 0.6, 15),
        "--primary-foreground": hsl(s, 98),
        "--ring": hsl(s * 0.6, 40),
      };
  base["--card-foreground"] = base["--foreground"];
  base["--popover-foreground"] = base["--foreground"];
  base["--secondary-foreground"] = base["--foreground"];
  base["--accent-foreground"] = base["--foreground"];
  base["--rim-ink-color"] = dark ? "0 0% 100%" : hsl(Math.min(s * 1.5, 30), 20);
  base["--brand"] = brand;
  base["--brand-foreground"] = brandFg;
  if (uses.primary) {
    base["--primary"] = brand;
    base["--primary-foreground"] = brandFg;
  }
  if (uses.ring) base["--ring"] = brand;
  return base;
}

function cssBlock(selector: string, vars: Record<string, string>) {
  return `${selector} {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`;
}

const SLIDERS: { key: keyof Theme; label: string; min: number; max: number; step: number; unit?: string }[] = [
  { key: "hue", label: "Base hue", min: 0, max: 360, step: 1, unit: "°" },
  { key: "sat", label: "Base tint", min: 0, max: 60, step: 1, unit: "%" },
  { key: "light", label: "Background lightness", min: 0, max: 100, step: 0.5, unit: "%" },
  { key: "accentHue", label: "Accent hue", min: 0, max: 360, step: 1, unit: "°" },
  { key: "accentSat", label: "Accent saturation", min: 0, max: 100, step: 1, unit: "%" },
  { key: "accentLight", label: "Accent lightness", min: 10, max: 90, step: 1, unit: "%" },
];

function Controls({ label, theme, onChange }: { label: string; theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="h-3.5 w-3.5 rounded-full" style={{ background: `hsl(${theme.hue} ${theme.sat}% ${theme.light}%)`, boxShadow: "inset 0 0 0 1px hsl(var(--border) / 0.3)" }} />
        <span className="h-3.5 w-3.5 rounded-full" style={{ background: `hsl(${theme.accentHue} ${theme.accentSat}% ${theme.accentLight}%)` }} />
      </div>
      {SLIDERS.map((c) => (
        <label key={c.key} className="grid grid-cols-[9rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-xs">
          <span className="text-muted-foreground">{c.label}</span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={theme[c.key]}
            onChange={(e) => onChange({ ...theme, [c.key]: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <span className="text-right font-mono tabular-nums">
            {theme[c.key]}
            {c.unit}
          </span>
        </label>
      ))}
    </div>
  );
}

/** A slice of the app, rendered with the candidate variables. */
function Preview({ vars, dark, uses }: { vars: Record<string, string>; dark: boolean; uses: Uses }) {
  const [seg, setSeg] = useState("month");
  const [on, setOn] = useState(true);
  const brandText = { color: "hsl(var(--brand))" } as const;
  return (
    <div
      className={cn("flex flex-col overflow-hidden rounded-xl bg-background text-foreground", dark && "dark")}
      style={{ ...(vars as React.CSSProperties), colorScheme: dark ? "dark" : "light", boxShadow: "0 0 0 1px hsl(var(--border) / 0.2)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <span className="mr-2 text-sm font-semibold font-display">Open Portal</span>
        {[
          { icon: LayoutGrid, label: "Dashboard", active: true },
          { icon: Calendar, label: "Calendar" },
          { icon: Trophy, label: "Scoreboard" },
        ].map((t) => (
          <span
            key={t.label}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
              t.active
                ? uses.nav
                  ? "font-medium"
                  : "bg-foreground font-medium text-background"
                : "text-muted-foreground",
            )}
            style={t.active && uses.nav ? { background: "hsl(var(--brand))", color: "hsl(var(--brand-foreground))" } : undefined}
          >
            <t.icon size={13} /> {t.label}
          </span>
        ))}
        <Bell size={14} className="ml-auto text-muted-foreground" />
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold tracking-tight">Calendar</h3>
          <Segmented
            value={seg}
            onChange={setSeg}
            size="xs"
            options={["month", "week", "agenda"].map((v) => ({
              value: v,
              label: v[0].toUpperCase() + v.slice(1),
              indicatorClassName: uses.selection ? "bg-[hsl(var(--brand))]" : undefined,
              selectedTextClassName: uses.selection ? "text-[hsl(var(--brand-foreground))]" : undefined,
            }))}
          />
        </div>

        {/* Card */}
        <div className="flex flex-col gap-2 rounded-xl surface p-3">
          <div className="flex items-center gap-2">
            <span className="h-8 w-1 rounded-full bg-[#6d5dfc]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">OP · GM #10</span>
              <span className="text-xs text-muted-foreground">Thu 8:00 – 9:00 PM · VLSB 2060</span>
            </div>
            <span className="text-xs text-success">Present</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Body copy and muted text on the card surface.{" "}
            <a className={cn("underline underline-offset-2", !uses.links && "text-foreground")} style={uses.links ? brandText : undefined}>
              A link
            </a>
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Primary</Button>
          <Button size="sm" variant="outline">Outline</Button>
          <Button size="sm" variant="ghost">Ghost</Button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={on} onCheckedChange={setOn} /> Switch
          </div>
        </div>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Focus me to see the ring…" className="h-8 pl-8 text-xs" />
        </div>

        {/* List rows */}
        <div className="flex flex-col divide-y divide-foreground/[0.06]">
          {["Samantha Van", "Shelsy Corado", "Dylan Chen"].map((n, i) => (
            <div key={n} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-foreground/[0.04]">
              <span className="underline decoration-dotted underline-offset-2">{n}</span>
              <span className={cn("text-xs", i === 2 ? "text-destructive" : "text-success")}>{i === 2 ? "Rejected" : "Accepted"}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">muted</span>
          <span className="rounded-md bg-accent px-2 py-1">accent (hover)</span>
          <span className="rounded-md bg-card px-2 py-1 shadow-edge">card</span>
          <span className="rounded-md px-2 py-1 font-medium" style={{ background: "hsl(var(--brand))", color: "hsl(var(--brand-foreground))" }}>
            brand
          </span>
        </div>
      </div>
    </div>
  );
}

const USE_LABELS: { key: keyof Uses; label: string }[] = [
  { key: "primary", label: "Primary buttons & switches" },
  { key: "ring", label: "Focus ring" },
  { key: "selection", label: "Selected segment" },
  { key: "nav", label: "Active header tab" },
  { key: "links", label: "Links" },
];

export default function TintLab() {
  const [dark, setDark] = useState<Theme>(PRESETS[1].dark);
  const [light, setLight] = useState<Theme>(PRESETS[1].light);
  const [uses, setUses] = useState<Uses>({ primary: false, ring: true, selection: true, links: true, nav: false });
  const [copied, setCopied] = useState(false);

  const darkVars = useMemo(() => themeVars(dark, true, uses), [dark, uses]);
  const lightVars = useMemo(() => themeVars(light, false, uses), [light, uses]);
  const css = `${cssBlock(":root", lightVars)}\n\n${cssBlock(".dark", darkVars)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(css);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Tint lab</h1>
        <p className="text-sm text-muted-foreground">
          A barely-there base tint and one accent per theme. Both previews use the real components.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.name}
            size="sm"
            variant="outline"
            onClick={() => {
              setDark(p.dark);
              setLight(p.light);
            }}
          >
            {p.name}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto gap-1.5" onClick={copy}>
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy CSS"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">Accent on</span>
        {USE_LABELS.map((u) => (
          <label key={u.key} className="flex items-center gap-1.5">
            <Switch checked={uses[u.key]} onCheckedChange={(v) => setUses((prev) => ({ ...prev, [u.key]: v }))} />
            {u.label}
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Preview vars={darkVars} dark uses={uses} />
          <Controls label="Dark" theme={dark} onChange={setDark} />
        </div>
        <div className="flex flex-col gap-4">
          <Preview vars={lightVars} dark={false} uses={uses} />
          <Controls label="Light" theme={light} onChange={setLight} />
        </div>
      </div>

      <details className="rounded-lg bg-foreground/[0.03] p-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">CSS for globals.css</summary>
        <pre className="mt-2 overflow-x-auto font-mono leading-relaxed">{css}</pre>
      </details>
    </div>
  );
}
