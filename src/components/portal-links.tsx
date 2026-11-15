"use client";

import { useState, type ComponentType } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { GithubMark } from "@/components/social-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toastSaved } from "@/lib/saved-toast";

export type PortalLinkKey = "github_url" | "notion_url" | "slack_url" | "linear_url";
export type PortalLinkValues = Record<PortalLinkKey, string | null>;

type MarkProps = { size?: number; className?: string };

// Notion and Linear follow currentColor so they flip with the theme; Slack
// keeps its four brand colours, which read on both backgrounds.
function NotionMark({ size = 16, className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className} aria-hidden>
      <g transform="matrix(2.56,0,0,2.56,5.48608,0)">
        <path
          fillRule="evenodd"
          d="M61.35,0.227L6.017,4.314C1.553,4.7 0,7.617 0,11.113L0,71.773C0,74.496 0.967,76.826 3.3,79.94L16.307,96.853C18.444,99.576 20.387,100.16 24.467,99.966L88.724,96.076C94.157,95.689 95.714,93.159 95.714,88.883L95.714,20.64C95.714,18.43 94.841,17.793 92.271,15.907L74.167,3.143C69.894,0.036 68.147,-0.357 61.35,0.226L61.35,0.227ZM25.92,19.523C20.673,19.876 19.483,19.956 16.503,17.533L8.927,11.507C8.157,10.727 8.544,9.754 10.484,9.56L63.677,5.673C68.144,5.283 70.47,6.84 72.217,8.2L81.34,14.81C81.73,15.007 82.7,16.17 81.533,16.17L26.6,19.477L25.92,19.524L25.92,19.523ZM19.803,88.3L19.803,30.367C19.803,27.837 20.58,26.67 22.906,26.474L86,22.78C88.14,22.587 89.107,23.947 89.107,26.473L89.107,84.02C89.107,86.55 88.717,88.69 85.224,88.883L24.847,92.383C21.354,92.576 19.804,91.413 19.804,88.3L19.803,88.3ZM79.403,33.473C79.79,35.223 79.403,36.973 77.653,37.173L74.743,37.75L74.743,80.523C72.216,81.883 69.89,82.66 67.946,82.66C64.839,82.66 64.063,81.687 61.736,78.773L42.706,48.833L42.706,77.8L48.726,79.163C48.726,79.163 48.726,82.663 43.869,82.663L30.479,83.44C30.089,82.66 30.479,80.717 31.836,80.33L35.333,79.36L35.333,41.06L30.48,40.667C30.09,38.917 31.06,36.39 33.78,36.194L48.147,35.227L67.947,65.554L67.947,38.724L62.9,38.144C62.51,36.001 64.063,34.444 66.003,34.254L79.403,33.474L79.403,33.473Z"
        />
      </g>
    </svg>
  );
}

function SlackMark({ size = 16, className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} aria-hidden>
      <g transform="matrix(2.015748,0,0,2.015748,0,0)">
        <path fill="#E01E5A" d="M27.2,80C27.2,87.3 21.3,93.2 14,93.2C6.7,93.2 0.8,87.3 0.8,80C0.8,72.7 6.7,66.8 14,66.8L27.2,66.8L27.2,80ZM33.8,80C33.8,72.7 39.7,66.8 47,66.8C54.3,66.8 60.2,72.7 60.2,80L60.2,113C60.2,120.3 54.3,126.2 47,126.2C39.7,126.2 33.8,120.3 33.8,113L33.8,80Z" />
        <path fill="#36C5F0" d="M47,27C39.7,27 33.8,21.1 33.8,13.8C33.8,6.5 39.7,0.6 47,0.6C54.3,0.6 60.2,6.5 60.2,13.8L60.2,27L47,27ZM47,33.7C54.3,33.7 60.2,39.6 60.2,46.9C60.2,54.2 54.3,60.1 47,60.1L13.9,60.1C6.6,60.1 0.7,54.2 0.7,46.9C0.7,39.6 6.6,33.7 13.9,33.7L47,33.7Z" />
        <path fill="#2EB67D" d="M99.9,46.9C99.9,39.6 105.8,33.7 113.1,33.7C120.4,33.7 126.3,39.6 126.3,46.9C126.3,54.2 120.4,60.1 113.1,60.1L99.9,60.1L99.9,46.9ZM93.3,46.9C93.3,54.2 87.4,60.1 80.1,60.1C72.8,60.1 66.9,54.2 66.9,46.9L66.9,13.8C66.9,6.5 72.8,0.6 80.1,0.6C87.4,0.6 93.3,6.5 93.3,13.8L93.3,46.9Z" />
        <path fill="#ECB22E" d="M80.1,99.8C87.4,99.8 93.3,105.7 93.3,113C93.3,120.3 87.4,126.2 80.1,126.2C72.8,126.2 66.9,120.3 66.9,113L66.9,99.8L80.1,99.8ZM80.1,93.2C72.8,93.2 66.9,87.3 66.9,80C66.9,72.7 72.8,66.8 80.1,66.8L113.2,66.8C120.5,66.8 126.4,72.7 126.4,80C126.4,87.3 120.5,93.2 113.2,93.2L80.1,93.2Z" />
      </g>
    </svg>
  );
}

function LinearMark({ size = 16, className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className} aria-hidden>
      <g transform="matrix(2.56,0,0,2.56,0,0)">
        <path d="M1.225,61.523C1.003,60.574 2.133,59.977 2.822,60.666L39.334,97.178C40.023,97.867 39.426,98.997 38.477,98.775C20.052,94.452 5.548,79.948 1.225,61.523ZM0.002,46.889C-0.016,47.172 0.091,47.449 0.291,47.65L52.35,99.709C52.551,99.909 52.828,100.016 53.111,99.998C55.48,99.85 57.805,99.538 60.073,99.072C60.838,98.915 61.103,97.976 60.551,97.424L2.576,39.449C2.024,38.897 1.085,39.162 0.928,39.927C0.462,42.195 0.149,44.52 0.002,46.889ZM4.211,29.705C4.044,30.079 4.129,30.516 4.419,30.805L69.195,95.581C69.484,95.871 69.921,95.956 70.295,95.789C72.081,94.994 73.812,94.096 75.48,93.105C76.032,92.777 76.117,92.018 75.663,91.564L8.436,24.337C7.982,23.883 7.223,23.968 6.895,24.52C5.904,26.188 5.006,27.919 4.211,29.705ZM12.659,18.074C12.289,17.704 12.266,17.11 12.614,16.72C21.779,6.459 35.111,0 49.952,0C77.593,0 100,22.407 100,50.048C100,64.889 93.541,78.221 83.28,87.386C82.89,87.734 82.296,87.711 81.926,87.341L12.659,18.074Z" />
      </g>
    </svg>
  );
}

const KINDS: { key: PortalLinkKey; label: string; Icon: ComponentType<MarkProps>; placeholder: string }[] = [
  { key: "github_url", label: "GitHub", Icon: GithubMark, placeholder: "https://github.com/org/repo" },
  { key: "notion_url", label: "Notion", Icon: NotionMark, placeholder: "https://notion.so/…" },
  { key: "slack_url", label: "Slack", Icon: SlackMark, placeholder: "https://workspace.slack.com/archives/…" },
  { key: "linear_url", label: "Linear", Icon: LinearMark, placeholder: "https://linear.app/team/…" },
];

/** Trim; empty → null; bare "github.com/x" → "https://github.com/x". */
function normalizeLink(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

const ICON_BUTTON =
  "flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-foreground/[.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type Props = {
  portalId: string;
  links: PortalLinkValues;
  // Edit mode shows every slot (empty ones dimmed) and turns each into an editor.
  editing: boolean;
  onSaved: (links: PortalLinkValues) => void;
};

export function PortalLinks({ portalId, links, editing, onSaved }: Props) {
  const shown = editing ? KINDS : KINDS.filter((k) => links[k.key]);
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      {shown.map((k) =>
        editing ? (
          <LinkEditor key={k.key} kind={k} portalId={portalId} links={links} onSaved={onSaved} />
        ) : (
          <Tooltip key={k.key}>
            <TooltipTrigger asChild>
              <a
                href={links[k.key]!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={k.label}
                className={ICON_BUTTON}
              >
                <k.Icon size={17} />
              </a>
            </TooltipTrigger>
            <TooltipContent>{k.label}</TooltipContent>
          </Tooltip>
        ),
      )}
    </div>
  );
}

function LinkEditor({
  kind,
  portalId,
  links,
  onSaved,
}: {
  kind: (typeof KINDS)[number];
  portalId: string;
  links: PortalLinkValues;
  onSaved: (links: PortalLinkValues) => void;
}) {
  const current = links[kind.key];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async (value: string | null) => {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    // .select() so an RLS-blocked update (zero rows, no error) reads as a failure.
    const { data, error: updateError } = await supabase
      .from("portals")
      .update({ [kind.key]: value, updated_at: new Date().toISOString() })
      .eq("id", portalId)
      .select("github_url, notion_url, slack_url, linear_url")
      .maybeSingle();
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!data) {
      setError("You don't have permission to edit this portal.");
      return;
    }
    onSaved(data as PortalLinkValues);
    setOpen(false);
    toastSaved(value ? `${kind.label} link saved` : `${kind.label} link removed`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDraft(current ?? "");
          setError(null);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${current ? "Edit" : "Add"} ${kind.label} link`}
              className={cn(ICON_BUTTON, !current && "opacity-35 hover:opacity-100")}
            >
              <kind.Icon size={17} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{`${current ? "Edit" : "Add"} ${kind.label} link`}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void write(normalizeLink(draft));
          }}
        >
          <label htmlFor={`portal-link-${kind.key}`} className="flex items-center gap-2 text-sm font-medium">
            <kind.Icon size={14} /> {kind.label}
          </label>
          <Input
            id={`portal-link-${kind.key}`}
            autoFocus
            type="text"
            inputMode="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={kind.placeholder}
            className="h-8 text-sm"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            {current && (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void write(null)}>
                Remove
              </Button>
            )}
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
