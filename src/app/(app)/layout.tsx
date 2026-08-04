import { AppNavbar } from "@/components/app-navbar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { PortalMetaProvider } from "@/components/portal-meta-provider";

// Shared shell for the authenticated app: home, portals, the applicant flow,
// and the manager section. Replaces the old apply/ and protected/ layouts.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalMetaProvider>
      <main className="min-h-screen flex flex-col items-center">
        <div className="flex-1 w-full flex flex-col items-center">
          <AppNavbar />
          <div className="flex-1 w-full">{children}</div>
          <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
            <ThemeSwitcher />
          </footer>
        </div>
      </main>
    </PortalMetaProvider>
  );
}
