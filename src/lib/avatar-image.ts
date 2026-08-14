// Client-side crop + resize for square images (profile pictures, portal icons).
// Takes the source image and a pixel crop rect (from react-easy-crop) and
// produces a normalized square JPEG Blob at the requested size — the whole
// resize happens on a <canvas>, so no server/sharp is needed and EXIF metadata
// is discarded in the process.

export const AVATAR_SIZE = 128;
export const PORTAL_ICON_SIZE = 512;
const JPEG_QUALITY = 0.9;

export type PixelCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Load a File/Blob into an ImageBitmap, honoring EXIF orientation so portrait
// photos from phones aren't drawn sideways.
async function loadOrientedBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

/**
 * Draw the selected square crop of `file` onto a `size`x`size` canvas and return
 * it as a JPEG Blob. Defaults to the avatar size. The canvas is filled white
 * first so any transparent areas of the source encode as white (JPEG has no
 * alpha) rather than black.
 */
export async function getCroppedSquareJpeg(
  file: Blob,
  crop: PixelCrop,
  size: number = AVATAR_SIZE,
): Promise<Blob> {
  const bitmap = await loadOrientedBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas 2d context");

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      size,
      size,
    );

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to encode image"));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
