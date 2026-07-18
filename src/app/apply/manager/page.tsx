"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

const items = [
  { label: "Coffee Chats", href: "/apply/manager/coffee-chats", description: "Review and manage coffee chat bookings." },
  { label: "Infosession Attendance", href: "/apply/manager/infosession", description: "Track and manage infosession attendance." },
  { label: "Applications", href: "/apply/manager/applications", description: "Review submitted applications." },
];

export default function ManagerPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
        <div className="flex flex-col gap-6 w-full max-w-sm">
          <div className="flex flex-col gap-1">
            <Link href="/apply" className="text-sm text-muted-foreground hover:underline">← Back</Link>
            <h1 className="text-2xl font-bold">Application Manager</h1>
            <p className="text-sm text-muted-foreground">
              Handle coffee chats, infosession attendance, and applications.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {items.map(({ label, href, description }) => (
              <button
                key={href}
                onClick={() => router.push(href)}
                className="border rounded-md px-4 py-3 text-left flex flex-col gap-0.5 hover:bg-accent transition-colors"
              >
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </button>
            ))}
          </div>
        </div>
    </div>
  );
}
