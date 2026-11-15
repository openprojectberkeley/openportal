"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AVATAR_SIZE } from "@/lib/avatar-image";
import { uploadAvatar } from "@/lib/avatar-upload";
import { ImageCropField } from "@/components/image-crop-field";
import { initials } from "@/components/person-profile-provider";
import { cn } from "@/lib/utils";

type Props = {
  userId: string;
  value?: string | null;
  name?: string;
  onChange: (url: string) => void;
  className?: string;
};

/**
 * The avatar is its own upload button: hover/focus dims it and shows a camera,
 * a click opens the cropper. No separate "Change photo" button.
 */
export function AvatarPicker({ userId, value, name, onChange, className }: Props) {
  // The cropped image shows at once (a local object URL) and the cropper
  // closes; the upload runs behind it and the real URL replaces the preview.
  // The parent's value only ever receives the uploaded URL, so a blob: URL can
  // never be saved to the profile.
  const [preview, setPreview] = useState<string | null>(null);
  const handleCropped = (jpeg: Blob) => {
    const local = URL.createObjectURL(jpeg);
    setPreview(local);
    const supabase = createClient();
    uploadAvatar(supabase, userId, jpeg)
      .then((url) => onChange(url))
      .catch((err: unknown) =>
        toast.error("Couldn't upload photo", { description: err instanceof Error ? err.message : undefined }),
      )
      .finally(() => {
        setPreview(null);
        URL.revokeObjectURL(local);
      });
  };
  const shown = preview ?? value;

  return (
    <ImageCropField size={AVATAR_SIZE} cropShape="round" title="Crop photo" onCropped={handleCropped}>
      {(open, { error }) => (
        <>
          <ErrorToast error={error} />
          <button
            type="button"
            onClick={open}
            aria-label={value ? "Change photo" : "Upload photo"}
            className={cn(
              "group relative h-[72px] w-[72px] flex-shrink-0 overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              className,
            )}
          >
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt="" className={cn("h-full w-full object-cover", preview && "animate-pulse")} />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-foreground/10 text-lg font-semibold">
                {name ? initials(name) : ""}
              </span>
            )}
            <span
              aria-hidden
              className={cn(
                "absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
                !shown && "bg-black/30",
              )}
            >
              <Camera size={20} />
            </span>
          </button>
        </>
      )}
    </ImageCropField>
  );
}

function ErrorToast({ error }: { error: string | null | undefined }) {
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);
  return null;
}
