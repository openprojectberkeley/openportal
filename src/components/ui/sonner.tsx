"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/**
 * App toaster. Bottom-centre, so it never collides with the floating help /
 * "View as" dock in the bottom-right. Styled from the theme tokens so it reads
 * as one of our floating surfaces (faint edge, overlay shadow), not a library
 * default.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-center"
      gap={8}
      // Sonner paints its own background from these vars; point them at the
      // glass surface (the `glass` class below supplies the blur).
      style={
        {
          "--normal-bg": "hsl(var(--popover) / var(--glass-alpha))",
          "--normal-border": "hsl(var(--border) / var(--border-alpha))",
          "--normal-text": "hsl(var(--popover-foreground))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group glass !rounded-lg !shadow-overlay !font-sans",
          description: "!text-muted-foreground",
          actionButton: "!bg-foreground !text-background !rounded-md !font-medium",
          cancelButton: "!bg-muted !text-muted-foreground",
          error: "[&_[data-icon]]:!text-destructive",
          success: "[&_[data-icon]]:!text-success",
        },
      }}
    />
  );
}
