import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
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
            "--tw-prose-links": "hsl(var(--foreground))",
            "--tw-prose-bold": "hsl(var(--foreground))",
            "--tw-prose-counters": "hsl(var(--muted-foreground))",
            "--tw-prose-bullets": "hsl(var(--muted-foreground))",
            "--tw-prose-hr": "hsl(var(--border))",
            "--tw-prose-quotes": "hsl(var(--muted-foreground))",
            "--tw-prose-quote-borders": "hsl(var(--border))",
            "--tw-prose-captions": "hsl(var(--muted-foreground))",
            "--tw-prose-code": "hsl(var(--foreground))",
            "--tw-prose-pre-code": "hsl(var(--foreground))",
            "--tw-prose-pre-bg": "hsl(var(--muted))",
            "--tw-prose-th-borders": "hsl(var(--border))",
            "--tw-prose-td-borders": "hsl(var(--border))",
            // prose-invert reads the same tokens; the CSS vars in globals.css
            // already flip under .dark, so both themes resolve correctly.
            "--tw-prose-invert-body": "hsl(var(--foreground))",
            "--tw-prose-invert-headings": "hsl(var(--foreground))",
            "--tw-prose-invert-lead": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-links": "hsl(var(--foreground))",
            "--tw-prose-invert-bold": "hsl(var(--foreground))",
            "--tw-prose-invert-counters": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-bullets": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-hr": "hsl(var(--border))",
            "--tw-prose-invert-quotes": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-quote-borders": "hsl(var(--border))",
            "--tw-prose-invert-captions": "hsl(var(--muted-foreground))",
            "--tw-prose-invert-code": "hsl(var(--foreground))",
            "--tw-prose-invert-pre-code": "hsl(var(--foreground))",
            "--tw-prose-invert-pre-bg": "hsl(var(--muted))",
            "--tw-prose-invert-th-borders": "hsl(var(--border))",
            "--tw-prose-invert-td-borders": "hsl(var(--border))",
            // Inline code ships with backtick pseudo-elements; drop them and
            // give it a chip instead.
            "code::before": { content: '""' },
            "code::after": { content: '""' },
          },
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "slow-flash": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        // One-shot highlight sweep across a card, for the moment a draft pick
        // is confirmed and takes on its project's accent.
        shimmer: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(200%)" },
        },
      },
      animation: {
        "slow-flash": "slow-flash 1.8s ease-in-out infinite",
        shimmer: "shimmer 1.1s cubic-bezier(0.16, 1, 0.3, 1) 1",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
