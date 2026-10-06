// Pure parts of the icon storage path: which extension a produced blob is
// stored under, and the object key built from it. The crop/encode itself needs
// a real <canvas>, so it's exercised in the browser rather than here.

import { describe, it, expect } from "vitest";
import { ICON_EXTENSIONS, imageFormat } from "@/lib/avatar-image";
import { iconObjectPath } from "@/lib/icon-upload";

const blobOf = (type: string) => new Blob(["x"], { type });

describe("imageFormat", () => {
  it("maps each format the encoder emits", () => {
    expect(imageFormat(blobOf("image/webp"))).toEqual({ ext: "webp", contentType: "image/webp" });
    expect(imageFormat(blobOf("image/png"))).toEqual({ ext: "png", contentType: "image/png" });
    expect(imageFormat(blobOf("image/jpeg"))).toEqual({ ext: "jpg", contentType: "image/jpeg" });
  });

  it("falls back to JPEG for anything unexpected", () => {
    // A blob with no type at all is the realistic case here.
    expect(imageFormat(blobOf(""))).toEqual({ ext: "jpg", contentType: "image/jpeg" });
    expect(imageFormat(blobOf("image/avif"))).toEqual({ ext: "jpg", contentType: "image/jpeg" });
  });
});

describe("iconObjectPath", () => {
  it("keys the object by entity id", () => {
    expect(iconObjectPath("abc-123", "webp")).toBe("abc-123/icon.webp");
  });
});

describe("ICON_EXTENSIONS", () => {
  it("covers every extension imageFormat can return, so stale objects get cleaned up", () => {
    // uploadEntityIcon removes the other extensions before writing; if this list
    // ever drifts from imageFormat, a format switch silently double-stores.
    const emitted = ["image/webp", "image/png", "image/jpeg"].map((t) => imageFormat(blobOf(t)).ext);
    for (const ext of emitted) expect(ICON_EXTENSIONS).toContain(ext);
  });
});
