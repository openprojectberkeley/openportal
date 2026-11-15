import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "next-themes";
import { RoleSimulationProvider } from "@/components/role-simulation-provider";
import { PersonProfileProvider } from "@/components/person-profile-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WindowScrollbar } from "@/components/overlay-scrollbar";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Open Portal",
  description: "Open Project Berkeley Portal",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

// Numbers that need to line up (scores, countdowns, codes) use `font-mono`,
// which tailwind.config.ts points at this variable.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  display: "swap",
  subsets: ["latin"],
});

// Display face for headings (h1–h3, dialog titles, wordmarks): Satoshi, a
// geometric grotesk with more character than Geist at large sizes, still clean
// enough for UI. Body copy stays Geist. Self-hosted (Fontshare / ITF Free Font
// License, see src/fonts/satoshi/LICENSE.md); exposed as `font-display`.
const satoshi = localFont({
  src: "../fonts/satoshi/Satoshi-Variable.woff2",
  variable: "--font-display",
  weight: "300 900",
  display: "swap",
  adjustFontFallback: "Arial",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.className} ${geistMono.variable} ${satoshi.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={100} skipDelayDuration={300}>
            <RoleSimulationProvider>
              <PersonProfileProvider>
                {children}
              </PersonProfileProvider>
            </RoleSimulationProvider>
          </TooltipProvider>
          <WindowScrollbar />
          <Toaster />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
