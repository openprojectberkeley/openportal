"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { getCroppedSquareJpeg, type PixelCrop } from "@/lib/avatar-image";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB input cap

type RenderState = { saving: boolean; error: string | null };

type Props = {
  /** Output edge length of the produced square JPEG (e.g. 128 avatar, 512 icon). */
  size: number;
  cropShape?: "round" | "rect";
  title?: string;
  /**
   * Called with the cropped, resized square JPEG blob. May be async (e.g. it
   * uploads); while it runs the modal shows "Saving…", and it stays open if the
   * promise rejects so the error is visible.
   */
  onCropped: (blob: Blob) => void | Promise<void>;
  /**
   * Render the trigger. `open` launches the file picker; `state` exposes the
   * in-flight/validation status so the caller can place messages where it wants.
   */
  children: (open: () => void, state: RenderState) => React.ReactNode;
};

// Shared image pick → crop → square-JPEG flow, extracted so avatars and portal
// icons share one cropper. The caller owns the trigger UI and decides what to do
// with the resulting blob (upload now, or stash for later).
export function ImageCropField({ size, cropShape = "rect", title = "Crop image", onCropped, children }: Props) {
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
      const jpeg = await getCroppedSquareJpeg(original, croppedPixels, size);
      await onCropped(jpeg);
      closeCropper();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {children(() => fileInputRef.current?.click(), { saving, error })}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {mounted && src &&
        createPortal(
          // pointer-events-auto is required: when this field lives inside a
          // Radix modal Dialog, Radix sets `pointer-events: none` on <body> and
          // only re-enables it within the dialog's own subtree. This modal is a
          // sibling portal, so without this it inherits none and is dead to input.
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-auto">
            <div className="fixed inset-0 bg-black/60" onClick={closeCropper} />
            <div className="relative z-10 w-full max-w-md rounded-lg border bg-background shadow-lg flex flex-col">
              <div className="px-6 pt-6 pb-3">
                <h2 className="text-lg font-semibold">{title}</h2>
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
                  cropShape={cropShape}
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
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
