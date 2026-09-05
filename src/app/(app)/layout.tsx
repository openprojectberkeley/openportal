import { AppNavbar } from "@/components/app-navbar";
import { DeadlineCountdownBanner } from "@/components/deadline-countdown-banner";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { PortalMetaProvider } from "@/components/portal-meta-provider";
import { NotificationsProvider } from "@/components/notifications-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import { SupportButton } from "@/components/support-button";

// Shared shell for the authenticated app: home, portals, the applicant flow,
// and the manager section. Replaces the old apply/ and protected/ layouts.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalMetaProvider>
      <NotificationsProvider>
      <TimezoneSync />
      <main className="flex min-h-svh flex-col">
        <AppNavbar />
        <DeadlineCountdownBanner />
        {/* Content region fills the space between the sticky header and the
            footer. Fit pages use `flex-1` to fill/center it (no scroll); taller
            pages grow it and the window scrolls. */}
        <div className="flex w-full flex-1 flex-col">{children}</div>
        <footer className="w-full border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:justify-between">
            <p>© 2026 Open Project at Berkeley. All rights reserved.</p>
            <ThemeSwitcher />
          </div>
        </footer>
        <SupportButton />
      </main>
      </NotificationsProvider>
    </PortalMetaProvider>
  );
}
