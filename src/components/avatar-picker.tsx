"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AVATAR_SIZE } from "@/lib/avatar-image";
import { uploadAvatar } from "@/lib/avatar-upload";
import { ImageCropField } from "@/components/image-crop-field";
import { initials } from "@/components/person-profile-provider";

type Props = {
  userId: string;
  value?: string | null;
  name?: string;
  onChange: (url: string) => void;
};

export function AvatarPicker({ userId, value, name, onChange }: Props) {
  const handleCropped = async (jpeg: Blob) => {
    const supabase = createClient();
    const url = await uploadAvatar(supabase, userId, jpeg);
    onChange(url);
  };

  return (
    <ImageCropField size={AVATAR_SIZE} cropShape="round" title="Crop photo" onCropped={handleCropped}>
      {(open, { error }) => (
        <div className="flex items-center gap-4">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="Profile picture"
              className="h-16 w-16 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="h-16 w-16 rounded-full bg-foreground/10 flex items-center justify-center text-base font-semibold flex-shrink-0">
              {name ? initials(name) : ""}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Button type="button" variant="outline" size="sm" onClick={open}>
              {value ? "Change photo" : "Upload photo"}
            </Button>
            <p className="text-xs text-muted-foreground">JPEG/PNG, cropped to 128×128.</p>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        </div>
      )}
    </ImageCropField>
  );
}
