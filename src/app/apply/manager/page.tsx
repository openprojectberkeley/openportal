"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Coffee, FileText, Users } from "lucide-react";

const items = [
  { label: "Coffee Chats", href: "/apply/manager/coffee-chats", description: "Review and manage coffee chat bookings.", icon: Coffee },
  { label: "Infosession Attendance", href: "/apply/manager/infosession", description: "Track and manage infosession attendance.", icon: Users },
  { label: "Applications", href: "/apply/manager/applications", description: "Review submitted applications.", icon: FileText },
];

export default function ManagerPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-[calc(100svh-4rem)] w-full items-center justify-center p-6">
      <div className="flex flex-col gap-8 w-full max-w-md">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/apply"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ArrowLeft size={14} />
            Back
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Application Manager</h1>
          <p className="text-sm text-muted-foreground">
            Handle coffee chats, infosession attendance, and applications.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {items.map(({ label, href, description, icon: Icon }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="group border rounded-xl px-4 py-3.5 flex items-center gap-3.5 text-left bg-background hover:border-foreground/20 hover:shadow-sm transition-all"
            >
              <div className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 bg-foreground/5 text-foreground/70">
                <Icon size={18} />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
              <ArrowRight size={16} className="text-muted-foreground/50 flex-shrink-0 group-hover:translate-x-0.5 group-hover:text-muted-foreground transition-all" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
