// Copies the data files pdf.js loads at runtime (fonts, character maps, image
// decoders) into public/pdfjs, so the resume viewer never fetches them from a
// third-party CDN and they always match the installed pdfjs-dist version.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(process.cwd(), "public", "pdfjs");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(source, dir), join(target, dir), { recursive: true });
}
