// Client-side crop + resize for square images (profile pictures, portal/project/
// family icons). Takes the source image and a pixel crop rect (from
// react-easy-crop) and produces a normalized square Blob at the requested size —
// the whole resize happens on a <canvas>, so no server/sharp is needed and EXIF
// metadata is discarded in the process.

export const AVATAR_SIZE = 128;
// Icons render at 16–56px (FamilyMark tops out at 56, portal/project cards at
// 40), so 256 still covers a 2x display up to 128px. The old 512 was ~4x the
// pixels for no visible gain.
export const PORTAL_ICON_SIZE = 256;

const JPEG_QUALITY = 0.9;
// WebP is lossy here too; alpha survives, and at this quality a flat logo lands
// well under the JPEG it replaces.
const ALPHA_QUALITY = 0.9;

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

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode image"));
      },
      type,
      quality,
    );
  });
}

// Does the drawn canvas have any non-opaque pixel? One pass over the buffer;
// at 256x256 that's 65k pixels and a couple of milliseconds. Decides whether
// this image needs a format that carries alpha at all.
function hasTransparency(ctx: CanvasRenderingContext2D, size: number): boolean {
  const { data } = ctx.getImageData(0, 0, size, size);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Draw the selected square crop of `file` onto a `size`x`size` canvas and return
 * it as a Blob. Defaults to the avatar size.
 *
 * With `preserveAlpha` (icons), a source that actually has transparent pixels is
 * encoded to a format that keeps it, so the accent behind the icon shows through
 * instead of a baked-in white square. A source with no alpha — any photo — still
 * encodes as JPEG, which is what keeps this from inflating storage: the costly
 * format is only ever reached by the flat logo art that compresses well in it.
 *
 * Without `preserveAlpha` (avatars), the canvas is filled white first so any
 * transparent areas encode as white (JPEG has no alpha) rather than black.
 *
 * Read the returned blob's `type` to learn which format came back — callers use
 * it to pick the stored object's extension and content type.
 */
export async function getCroppedSquareImage(
  file: Blob,
  crop: PixelCrop,
  size: number = AVATAR_SIZE,
  { preserveAlpha = false }: { preserveAlpha?: boolean } = {},
): Promise<Blob> {
  const bitmap = await loadOrientedBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas 2d context");

    if (!preserveAlpha) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size);

    if (preserveAlpha && hasTransparency(ctx, size)) {
      // Ask for WebP, which carries alpha at a fraction of PNG's size. A browser
      // that can't encode it (Safari < 16) silently hands back PNG instead —
      // bigger, but still correct, and the caller reads blob.type either way.
      const blob = await encode(canvas, "image/webp", ALPHA_QUALITY);
      if (blob.type === "image/webp") return blob;
      return await encode(canvas, "image/png", 1);
    }

    // No alpha to keep (or not asked to keep it): JPEG, over a white backing so
    // a fully-opaque source is unaffected and a stray transparent edge doesn't
    // come out black.
    if (preserveAlpha) {
      const flattened = document.createElement("canvas");
      flattened.width = size;
      flattened.height = size;
      const fctx = flattened.getContext("2d");
      if (!fctx) throw new Error("Could not get canvas 2d context");
      fctx.fillStyle = "#fff";
      fctx.fillRect(0, 0, size, size);
      fctx.drawImage(canvas, 0, 0);
      return await encode(flattened, "image/jpeg", JPEG_QUALITY);
    }

    return await encode(canvas, "image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

// Extension + content type for a blob produced above, for naming the stored
// object. Falls back to JPEG for anything unexpected.
export function imageFormat(blob: Blob): { ext: string; contentType: string } {
  switch (blob.type) {
    case "image/webp":
      return { ext: "webp", contentType: "image/webp" };
    case "image/png":
      return { ext: "png", contentType: "image/png" };
    default:
      return { ext: "jpg", contentType: "image/jpeg" };
  }
}

// Every extension an icon object may have been stored under. Upload paths are
// stable per entity (`{id}/icon.{ext}`), so when the format changes the previous
// object has to be removed explicitly or it lingers and double-stores.
export const ICON_EXTENSIONS = ["jpg", "png", "webp"] as const;
