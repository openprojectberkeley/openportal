import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const source = join(root, "src/assets/open-portal-icon.png");
const appDir = join(root, "src/app");

/** Pack PNG buffers into a modern ICO (PNG-embedded entries). */
function packIco(images) {
  const count = images.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const parts = [Buffer.alloc(headerSize)];

  parts[0].writeUInt16LE(0, 0);
  parts[0].writeUInt16LE(1, 2);
  parts[0].writeUInt16LE(count, 4);

  images.forEach(({ width, height, buffer }, i) => {
    const entryOffset = 6 + i * 16;
    parts[0].writeUInt8(width >= 256 ? 0 : width, entryOffset);
    parts[0].writeUInt8(height >= 256 ? 0 : height, entryOffset + 1);
    parts[0].writeUInt8(0, entryOffset + 2);
    parts[0].writeUInt8(0, entryOffset + 3);
    parts[0].writeUInt16LE(1, entryOffset + 4);
    parts[0].writeUInt16LE(32, entryOffset + 6);
    parts[0].writeUInt32LE(buffer.length, entryOffset + 8);
    parts[0].writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
    parts.push(buffer);
  });

  return Buffer.concat(parts);
}

async function squareIcon(input, size) {
  const trimmed = await sharp(input).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width, meta.height);
  return sharp(trimmed)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function main() {
  const input = readFileSync(source);

  const icon32 = await squareIcon(input, 32);
  const icon180 = await squareIcon(input, 180);
  const icon16 = await squareIcon(input, 16);
  const icon48 = await squareIcon(input, 48);

  writeFileSync(join(appDir, "icon.png"), icon32);
  writeFileSync(join(appDir, "apple-icon.png"), icon180);
  writeFileSync(
    join(appDir, "favicon.ico"),
    packIco([
      { width: 16, height: 16, buffer: icon16 },
      { width: 32, height: 32, buffer: icon32 },
      { width: 48, height: 48, buffer: icon48 },
    ]),
  );

  console.log("Generated src/app/icon.png (32x32)");
  console.log("Generated src/app/apple-icon.png (180x180)");
  console.log("Generated src/app/favicon.ico (16, 32, 48)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
