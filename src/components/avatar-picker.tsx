"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { getCroppedSquareJpeg, type PixelCrop } from "@/lib/avatar-image";
import { uploadAvatar } from "@/lib/avatar-upload";
import { initials } from "@/components/person-profile-provider";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB input cap

type Props = {
  userId: string;
  value?: string | null;
  name?: string;
  onChange: (url: string) => void;
};

export function AvatarPicker({ userId, value, name, onChange }: Props) {
  const [mounted, setMounted] = useState(false);
  const [src, setSrc] = useState<string | null>(null); // object URL being cropped
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<PixelCrop | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Revoke the object URL when we're done with it to avoid leaking blobs.
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const onCropComplete = useCallback((_area: unknown, pixels: PixelCrop) => {
    setCroppedPixels(pixels);
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again re-triggers onChange.
    e.target.value = "";
    if (!file) return;

    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Image is too large (max 8 MB).");
      return;
    }

    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedPixels(null);
    setSrc(URL.createObjectURL(file));
  };

  const closeCropper = () => {
    if (src) URL.revokeObjectURL(src);
    setSrc(null);
    setCroppedPixels(null);
  };

  const handleSaveCrop = async () => {
    if (!src || !croppedPixels) return;
    setSaving(true);
    setError(null);
    try {
      // Fetch the object URL back into a Blob to crop from.
      const original = await fetch(src).then((r) => r.blob());
      const jpeg = await getCroppedSquareJpeg(original, croppedPixels);
      const supabase = createClient();
      const url = await uploadAvatar(supabase, userId, jpeg);
      onChange(url);
      closeCropper();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          {value ? "Change photo" : "Upload photo"}
        </Button>
        <p className="text-xs text-muted-foreground">JPEG/PNG, cropped to 128×128.</p>
        {error && !src && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {mounted && src &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/60" onClick={closeCropper} />
            <div className="relative z-10 w-full max-w-md rounded-lg border bg-background shadow-lg flex flex-col">
              <div className="px-6 pt-6 pb-3">
                <h2 className="text-lg font-semibold">Crop photo</h2>
                <p className="text-sm text-muted-foreground">
                  Drag to reposition, scroll or use the slider to zoom.
                </p>
              </div>
              <div className="relative h-72 w-full bg-black/80">
                <Cropper
                  image={src}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              </div>
              <div className="px-6 py-4 flex flex-col gap-3">
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  aria-label="Zoom"
                  className="w-full"
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeCropper}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleSaveCrop} disabled={saving}>
                    {saving ? "Saving..." : "Save photo"}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
