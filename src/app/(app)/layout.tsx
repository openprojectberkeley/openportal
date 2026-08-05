import { AppNavbar } from "@/components/app-navbar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { PortalMetaProvider } from "@/components/portal-meta-provider";

// Shared shell for the authenticated app: home, portals, the applicant flow,
// and the manager section. Replaces the old apply/ and protected/ layouts.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalMetaProvider>
      <main className="flex min-h-svh flex-col">
        <AppNavbar />
        {/* Content region fills the space between the sticky header and the
            footer. Fit pages use `flex-1` to fill/center it (no scroll); taller
            pages grow it and the window scrolls. */}
        <div className="flex w-full flex-1 flex-col">{children}</div>
        <footer className="w-full flex items-center justify-center border-t text-center text-xs gap-8 py-16">
          <ThemeSwitcher />
        </footer>
      </main>
    </PortalMetaProvider>
  );
}
