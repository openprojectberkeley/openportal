import { ArrowLeft } from "lucide-react";
import { FloatingMark } from "@/components/floating-mark";
import { InvertBlob } from "@/components/invert-blob";
import { OpenPortalBrandIcon } from "@/components/open-portal-brand-icon";

/**
 * Frame for the signed-out pages (sign in, reset, update password): a brand
 * panel on the left from lg up, the form on the right.
 *
 * The panel's art is the Open Portal mark taken apart: bowl, stem and hook
 * each drift on their own slow loop, as if hanging in space. Over the panel a
 * gooey cursor blob inverts everything it passes (InvertBlob). The panel is
 * `isolate` so the blob's difference blend reads only the panel itself.
 *
 * The panel follows the theme: a warm muted slab beside the form in light
 * mode, flush with the page (split by a border) in dark. The mark's gradients
 * read on either, and the blob's difference blend inverts light or dark alike.
 * "Open Portal" carries the site accent (--brand).
 */
const CLUB_SITE = "https://openprojectberkeley.com";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh w-full lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative isolate hidden overflow-hidden border-r bg-muted text-foreground dark:bg-background lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Back to the club's public site; the arrow nudges on hover like BackLink. */}
        <a
          href={CLUB_SITE}
          className="group relative z-10 inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={15} className="transition-transform group-hover:-translate-x-0.5" aria-hidden />
          Back to openprojectberkeley.com
        </a>

        <FloatingMark className="mx-auto w-[clamp(180px,20vw,300px)]" />

        <div className="flex max-w-md flex-col gap-3">
          {/* Two weights of one face: the product bold, the club as thin as
              Satoshi goes (300, the lightest weight in the variable font). */}
          <h1 className="text-4xl leading-[1.05] tracking-tight xl:text-5xl">
            <span className="font-bold text-brand">Open Portal</span>
            <br />
            <a
              href={CLUB_SITE}
              className="relative z-10 font-light tracking-normal underline-offset-[6px] decoration-1 hover:underline"
            >
              Open Project
            </a>
          </h1>
          <p className="text-base text-muted-foreground">
            we have a lot of portals i hope you like them :)
          </p>
        </div>

        <InvertBlob />
      </aside>

      <main className="flex items-center justify-center p-6 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-8">
          {/* Below lg the brand panel is hidden; keep the mark above the form. */}
          <div className="flex items-center gap-2.5 font-semibold tracking-tight lg:hidden">
            <OpenPortalBrandIcon className="h-8 w-auto" />
            Open Portal
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
