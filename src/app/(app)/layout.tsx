import { Suspense } from "react";
import { AppNavbar } from "@/components/app-navbar";
import { BannerRouteSync, HeaderBanners, HeaderBannersProvider } from "@/components/header-banners";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { PortalMetaProvider } from "@/components/portal-meta-provider";
import { NotificationsProvider } from "@/components/notifications-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import { SupportButton } from "@/components/support-button";
import { ArrowUpRight } from "lucide-react";

// Shared shell for the authenticated app: home, portals, the applicant flow,
// and the manager section. Replaces the old apply/ and protected/ layouts.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalMetaProvider>
      <NotificationsProvider>
      <TimezoneSync />
      <main className="flex min-h-svh flex-col">
        {/* Announcements + the deadline countdown: full size under the header,
            docking as a slim strip on the header once scrolled past. */}
        <HeaderBannersProvider>
          <AppNavbar />
          {/* usePathname() is dynamic; Suspense lets the rest prerender. */}
          <Suspense fallback={null}>
            <BannerRouteSync />
          </Suspense>
          <HeaderBanners />
        </HeaderBannersProvider>
        {/* Content region fills the space between the sticky header and the
            footer. Fit pages use `flex-1` to fill/center it (no scroll); taller
            pages grow it and the window scrolls. */}
        <div className="flex w-full flex-1 flex-col">{children}</div>
        {/* One quiet line, left-aligned so it never runs under the floating
            dock on the right (support-button.tsx). On phones the items stack
            and the extra bottom padding clears the dock instead. */}
        <footer className="w-full">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-3 px-5 pb-20 pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-5 sm:pb-5">
            <span className="font-medium text-foreground">Open Portal</span>
            <a
              href="https://openprojectberkeley.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              openprojectberkeley.com
              <ArrowUpRight size={12} aria-hidden />
            </a>
            <span>© 2026 Open Project at Berkeley</span>
            <ThemeSwitcher />
          </div>
        </footer>
        <SupportButton />
      </main>
      </NotificationsProvider>
    </PortalMetaProvider>
  );
}
