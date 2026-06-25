import { AppNavbar } from "@/components/app-navbar";

export default function ApplyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col items-center">
        <AppNavbar />
        <div className="flex-1 w-full">
          {children}
        </div>
      </div>
    </main>
  );
}
