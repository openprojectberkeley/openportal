import { AppNavbar } from "@/components/app-navbar";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col">
      <AppNavbar tabs={false} />
      <div className="flex w-full flex-1 flex-col">{children}</div>
    </main>
  );
}
