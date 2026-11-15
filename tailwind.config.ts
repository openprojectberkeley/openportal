import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  darkMode: ["class"],
  // Wrap every `hover:` in @media (hover: hover) so a tap on a touch screen
  // doesn't leave a hover style stuck on until the next tap elsewhere.
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // The site accent: ember in dark, periwinkle in light (globals.css).
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        // Edges are translucent (alpha lives in its own var, globals.css), so a
        // hairline picks up whatever surface it sits on and reads as glass
        // rather than a grey rule. `<alpha-value>` still composes: border-border/50.
        border: "hsl(var(--border) / calc(var(--border-alpha) * <alpha-value>))",
        input: "hsl(var(--input) / calc(var(--input-alpha) * <alpha-value>))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      // Point @tailwindcss/typography at this app's own tokens. Its stock
      // `prose` is a neutral-gray, 16px scale; the app is a tinted HSL palette
      // at 14px, so without this the markdown page reads as foreign text
      // pasted onto the page.
      typography: {
        DEFAULT: {
          css: {
            "--tw-prose-body": "hsl(var(--foreground))",
            "--tw-prose-headings": "hsl(var(--foreground))",
            "--tw-prose-lead": "hsl(var(--muted-foreground))",
            "--tw-prose-links": "hsl(var(--brand))",
            "--tw-prose-bold": "hsl(var(--foreground))",
            "--tw-prose-counters": "hsl(var(--muted-foreground))",
            "--tw-prose-bullets": "hsl(var(--muted-foreground))",
            "--tw-prose-hr": "hsl(var(--border) / var(--border-alpha))",
            "--tw-prose-quotes": "hsl(var(--muted-foreground))",
            "--tw-prose-quote-borders": "hsl(var(--border) / var(--border-alpha))",
            "--tw-prose-captions": "hsl(var(--muted-foreground))",
            "--tw-prose-code": "hsl(var(--foreground))",
            "--tw-prose-pre-code": "hsl(var(--foreground))",
            "--tw-prose-pre-bg": "hsl(var(--muted))",
            "--tw-prose-th-borders": "hsl(var(--border) / var(--border-alpha))",
            "--tw-prose-td-borders": "hsl(var(--border) / var(--border-alpha))",
            // prose-invert reads the same tokens; the CSS vars in globals.css
            // already flip under .dark, so both themes resolve correctly.
            "--tw-prose-invert-body": "hsl(var(--foreground))",
            "--tw-prose-invert-headings": "hsl(var(--foreground))",
            "--tw-prose-invert-lead": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-links": "hsl(var(--foreground))",
            "--tw-prose-invert-bold": "hsl(var(--foreground))",
            "--tw-prose-invert-counters": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-bullets": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-hr": "hsl(var(--border) / var(--border-alpha))",
            "--tw-prose-invert-quotes": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-quote-borders": "hsl(var(--border) / var(--border-alpha))",
            "--tw-prose-invert-captions": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-code": "hsl(var(--foreground))",
            "--tw-prose-invert-pre-code": "hsl(var(--foreground))",
            "--tw-prose-invert-pre-bg": "hsl(var(--muted))",
            "--tw-prose-invert-th-borders": "hsl(var(--border) / var(--border-alpha))",
            "--tw-prose-invert-td-borders": "hsl(var(--border) / var(--border-alpha))",
            // Inline code ships with backtick pseudo-elements; drop them and
            // give it a chip instead.
            "code::before": { content: '""' },
            "code::after": { content: '""' },
          },
        },
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", ...defaultTheme.fontFamily.mono],
        display: ["var(--font-display)", ...defaultTheme.fontFamily.sans],
      },
      // Motion tokens (app/globals.css). tailwindcss-animate reads these same
      // scales, so `duration-2 ease-out-quart` times both a transition and a
      // Radix enter/exit animation.
      // DEFAULT is what a bare `transition-colors` gets: the instant tier, so
      // every common hover snaps (<100ms). `duration-instant` names it
      // explicitly; `duration-0` stays Tailwind's 0s.
      transitionDuration: {
        DEFAULT: "var(--dur-0)",
        instant: "var(--dur-0)",
        "1": "var(--dur-1)",
        "2": "var(--dur-2)",
        "3": "var(--dur-3)",
        "4": "var(--dur-4)",
        "5": "var(--dur-5)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease-out-quad)",
        "out-quad": "var(--ease-out-quad)",
        "out-cubic": "var(--ease-out-cubic)",
        "out-quart": "var(--ease-out-quart)",
        "out-expo": "var(--ease-out-expo)",
        "in-out-cubic": "var(--ease-in-out-cubic)",
        "in-out-quart": "var(--ease-in-out-quart)",
      },
      boxShadow: {
        // Floating surfaces (menus, popovers, dialogs): a faint lit top edge
        // (--edge-hi) instead of a hard outline, plus a soft drop.
        overlay:
          "inset 0 1px 0 0 hsl(var(--edge-hi)), 0 12px 32px -12px rgb(0 0 0 / 0.28), 0 2px 8px -2px rgb(0 0 0 / 0.08)",
        edge: "inset 0 1px 0 0 hsl(var(--edge-hi))",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "slow-flash": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        // Content replacing its skeleton: a short settle instead of a hard cut.
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // A count badge arriving or changing. No overshoot: it's feedback, not
        // a toy.
        pop: {
          from: { opacity: "0", transform: "scale(0.9)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        // A score bar drawing itself in from the left on first paint. Only a
        // `from`: the end state is whatever clip-path the bar already has.
        "bar-in": {
          from: { clipPath: "inset(0 100% 0 0 round 9999px)" },
        },
        // An expanding row/panel growing to its natural height (no measuring:
        // grid-template-rows interpolates 0fr -> 1fr).
        "expand-rows": {
          from: { gridTemplateRows: "0fr", opacity: "0" },
          to: { gridTemplateRows: "1fr", opacity: "1" },
        },
        // "There's more below" hint: a couple of nudges, then it rests.
        nudge: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(3px)" },
        },
        // A Save button confirming: a quick bump, so a click reads as landed.
        "save-pop": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)" },
        },
        // The edited card answering the save: a success ring that swells and fades.
        "save-ring": {
          "0%": { boxShadow: "0 0 0 0 hsl(var(--success) / 0.55)" },
          "100%": { boxShadow: "0 0 0 8px hsl(var(--success) / 0)" },
        },
        // A thin bar sliding across while a page of rows loads.
        indeterminate: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(300%)" },
        },
      },
      animation: {
        "slow-flash": "slow-flash 1.8s ease-in-out infinite",
        "fade-in-up": "fade-in-up var(--dur-2) var(--ease-out-quart) both",
        pop: "pop var(--dur-2) var(--ease-out-quart) both",
        "save-pop": "save-pop var(--dur-3) var(--ease-out-quart)",
        "save-ring": "save-ring 600ms var(--ease-out-quart)",
        indeterminate: "indeterminate 1s var(--ease-in-out-cubic) infinite",
        nudge: "nudge 600ms var(--ease-in-out-cubic) 2",
        expand: "expand-rows var(--dur-3) var(--ease-out-quart) both",
        // `backwards`, not `both`: once it has played, the bar's own
        // clip-path transition must be free to animate score changes.
        "bar-in": "bar-in 700ms var(--ease-out-expo) backwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
