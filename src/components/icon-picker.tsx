"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ImageUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImageCropField } from "@/components/image-crop-field";
import { PortalDefaultIcon } from "@/components/portal-default-icon";
import { PORTAL_ICON_SIZE } from "@/lib/avatar-image";
import { uploadPortalIcon } from "@/lib/portal-icon-upload";
import { uploadProjectIcon } from "@/lib/project-icon-upload";
import { uploadFamilyIcon } from "@/lib/family-icon-upload";
import { toast } from "sonner";

// Curated emoji set for portal icons — no emoji library needed.
// Each emoji with the words someone would type to find it (the grid has a
// search box). Order is the grid's order.
const PORTAL_EMOJI_KEYWORDS: [string, string][] = [
  ["🚪", "door portal entry"], ["📁", "folder files"], ["💻", "laptop computer code dev"], ["🎨", "art design palette"],
  ["📣", "megaphone announce marketing"], ["🤝", "handshake partner client"], ["📊", "chart bar analytics data"], ["🧠", "brain ai ml mind"],
  ["🚀", "rocket launch startup"], ["⚙️", "gear settings engineering"], ["📅", "calendar date events"], ["🎯", "target goal"],
  ["🏆", "trophy win award"], ["💡", "idea bulb light"], ["🔧", "wrench tool fix"], ["📌", "pin"],
  ["🌐", "globe web internet world"], ["📝", "memo notes write"], ["🎓", "graduation school education"], ["⭐", "star favorite"],
  ["🔬", "microscope science research"], ["🎤", "microphone talk speaker"], ["📷", "camera photo"], ["🎬", "film movie video"],
  ["🏗️", "construction build"], ["🧩", "puzzle piece game"], ["📚", "books library study"], ["✏️", "pencil edit"],
  ["🗂️", "dividers organize"], ["💬", "chat message speech"], ["🔔", "bell notification"], ["🧭", "compass navigation map"],
  ["🏅", "medal sports"], ["🎟️", "ticket event"], ["🍕", "pizza food social"], ["☕", "coffee chat cafe"],
  ["🎵", "music note"], ["🕹️", "joystick game gaming"], ["🌱", "seedling plant growth green"], ["🔒", "lock security private"],
  ["📈", "chart up growth finance"], ["🛠️", "tools hammer build"], ["🧪", "test tube lab chemistry"], ["🗓️", "calendar schedule"],
  ["🤖", "robot ai bot"], ["🧵", "thread sewing fashion"], ["🏦", "bank finance money"], ["🎉", "party celebrate"],
];
const PORTAL_EMOJIS = PORTAL_EMOJI_KEYWORDS.map(([e]) => e);

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Current icon image URL, if any. When set, the image wins over the emoji. */
  imageUrl?: string | null;
  /** Set/clear the icon image URL (real URL in immediate mode, preview URL in deferred). */
  onImageChange?: (url: string | null) => void;
  /**
   * Deferred mode only: receives the cropped blob (or null on clear) so the
   * parent can upload it after the portal row exists (create flow).
   */
  onImageBlob?: (blob: Blob | null) => void;
  /**
   * When provided, uploads happen immediately keyed by this portal id (edit
   * flow). When omitted, the picker runs in deferred mode and hands the blob up
   * via `onImageBlob`.
   */
  portalId?: string;
  /**
   * Like `portalId`, but uploads to the `projects` bucket keyed by this project
   * id (project edit flow). Takes precedence over `portalId` when set.
   */
  projectId?: string;
  /**
   * Like `portalId`, but uploads to the `families` bucket keyed by this family
   * id (family edit flow). Takes precedence over both of the above when set.
   */
  familyId?: string;
};

export function IconPicker({
  value,
  onChange,
  imageUrl,
  onImageChange,
  onImageBlob,
  portalId,
  projectId,
  familyId,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const eq = emojiQuery.trim().toLowerCase();
  const shownEmojis = eq
    ? PORTAL_EMOJI_KEYWORDS.filter(([, words]) => words.includes(eq)).map(([e]) => e)
    : PORTAL_EMOJIS;
  // Shown while an immediate-mode upload is in flight (see handleCropped).
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const shownImage = localPreview ?? imageUrl;
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape. Escape is stopped from bubbling so it
  // dismisses the picker rather than the enclosing Dialog.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen]);

  const close = () => {
    setMenuOpen(false);
    setAdding(false);
    setCustom("");
    setCustomError(null);
  };

  // Choosing an emoji (or "None") drops any uploaded image so the emoji shows.
  const clearImage = () => {
    onImageChange?.(null);
    onImageBlob?.(null);
  };

  const pick = (emoji: string) => {
    onChange(emoji);
    clearImage();
    close();
  };

  const addCustom = () => {
    const trimmed = custom.trim();
    // Lock the custom entry to an actual emoji — reject plain text.
    if (!/\p{Extended_Pictographic}/u.test(trimmed)) {
      setCustomError("Enter a single emoji.");
      return;
    }
    // Normalize to the first grapheme so multi-codepoint emoji stay intact.
    let emoji = trimmed;
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const first = seg.segment(trimmed)[Symbol.iterator]().next().value;
      if (first) emoji = first.segment;
    }
    onChange(emoji);
    clearImage();
    close();
  };

  const handleCropped = async (jpeg: Blob) => {
    if (familyId || projectId || portalId) {
      // Immediate mode: preview the crop at once and close; upload behind it
      // and hand back the public URL when it lands (never the blob: URL).
      const local = URL.createObjectURL(jpeg);
      setLocalPreview(local);
      const supabase = createClient();
      const upload = familyId
        ? uploadFamilyIcon(supabase, familyId, jpeg)
        : projectId
          ? uploadProjectIcon(supabase, projectId, jpeg)
          : uploadPortalIcon(supabase, portalId!, jpeg);
      upload
        .then((url) => onImageChange?.(url))
        .catch((err: unknown) =>
          toast.error("Couldn't upload icon", { description: err instanceof Error ? err.message : undefined }),
        )
        .finally(() => {
          setLocalPreview(null);
          URL.revokeObjectURL(local);
        });
    } else {
      // Deferred mode: preview locally now, upload after the row is created.
      onImageChange?.(URL.createObjectURL(jpeg));
      onImageBlob?.(jpeg);
    }
    close();
  };

  return (
    <ImageCropField
      size={PORTAL_ICON_SIZE}
      cropShape="rect"
      title="Crop icon"
      preserveAlpha
      onCropped={handleCropped}
    >
      {(openFilePicker, { saving, error }) => (
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="h-9 w-full flex items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {shownImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownImage} alt="Portal icon" className="h-6 w-6 rounded object-cover" />
            ) : value ? (
              <span className="text-lg leading-none">{value}</span>
            ) : (
              <PortalDefaultIcon className="h-5 w-5 text-foreground" />
            )}
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>

          {menuOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-md border glass p-2 shadow-overlay">
              {adding ? (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Custom emoji</span>
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={custom}
                      onChange={(e) => { setCustom(e.target.value); setCustomError(null); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addCustom(); }
                      }}
                      placeholder="Paste an emoji"
                      className="flex-1"
                    />
                    <Button type="button" size="sm" onClick={addCustom}>Add</Button>
                  </div>
                  {customError && <p className="text-xs text-destructive">{customError}</p>}
                  <button
                    type="button"
                    onClick={() => { setAdding(false); setCustom(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground self-start"
                  >
                    ← Back
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    autoFocus
                    value={emojiQuery}
                    onChange={(e) => setEmojiQuery(e.target.value)}
                    placeholder="Search icons (rocket, chart…)"
                    aria-label="Search icons"
                    className="mb-2 h-8 text-xs"
                  />
                  {shownEmojis.length === 0 && (
                    <p className="py-3 text-center text-xs text-muted-foreground">No icons match. Paste your own below.</p>
                  )}
                  <div className="grid grid-cols-8 gap-1">
                    {shownEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => pick(emoji)}
                        className={cn(
                          "h-7 w-7 flex items-center justify-center rounded text-lg hover:bg-accent transition-colors",
                          !imageUrl && value === emoji && "ring-2 ring-ring",
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setAdding(true)}
                      aria-label="Add custom emoji"
                      className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={openFilePicker}
                    disabled={saving}
                    className={cn(
                      "mt-2 w-full flex items-center justify-center gap-1.5 rounded border border-dashed py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-60",
                      imageUrl && "ring-2 ring-ring text-foreground",
                    )}
                  >
                    <ImageUp size={13} /> {imageUrl ? "Replace image" : "Upload image"}
                  </button>
                  {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
                  <div className="mt-2 flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => pick("")}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X size={12} /> None
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </ImageCropField>
  );
}
