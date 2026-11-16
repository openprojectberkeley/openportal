import Link from "next/link";
import { ArrowRight, Coffee, FileText, Users } from "lucide-react";
import { BackLink } from "@/components/back-link";

const items = [
  { label: "Coffee Chats", href: "/manager/coffee-chats", description: "Review and manage coffee chat bookings.", icon: Coffee },
  { label: "Infosession Attendance", href: "/manager/infosession", description: "Track and manage infosession attendance.", icon: Users },
  { label: "Applications", href: "/manager/applications", description: "Review submitted applications.", icon: FileText },
];

// The Application Manager landing menu. Entirely static, so it is also what
// the manager layout shows while its access check runs: the real menu, not a
// picture of it.
export function ManagerMenu() {
  return (
    <div className="flex flex-1 w-full items-center justify-center p-6">
      <div className="flex flex-col gap-8 w-full max-w-md">
        <div className="flex flex-col gap-1.5">
          <BackLink href="/" label="Dashboard" />
          <h1 className="text-2xl font-bold tracking-tight">Application Manager</h1>
          <p className="text-sm text-muted-foreground">
            Handle coffee chats, infosession attendance, and applications.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {items.map(({ label, href, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-xl px-4 py-3.5 flex items-center gap-3.5 text-left surface rim-card transition-colors hover:bg-foreground/[0.07]"
            >
              <div className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 bg-foreground/5 text-foreground/70">
                <Icon size={18} />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
              <ArrowRight size={16} className="text-muted-foreground/50 flex-shrink-0 group-hover:translate-x-0.5 group-hover:text-muted-foreground transition-[transform,color] duration-instant ease-out-quart" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
