/**
 * Generate PWA icons from the app's SVG icon design.
 * Run once: node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

function makeSvg(size, maskable = false) {
  const rx = maskable ? 0 : Math.round(size * 6 / 32);
  const fontSize = Math.round(size * 18 / 32);
  const textY = Math.round(size * 22.5 / 32);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#0d9488"/>
  <text x="${size / 2}" y="${textY}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="700" fill="#fff">RI</text>
</svg>`);
}

const icons = [
  { name: "icon-192.png",  size: 192, maskable: false },
  { name: "icon-512.png",  size: 512, maskable: false },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
];

for (const icon of icons) {
  const svg = makeSvg(icon.size, icon.maskable);
  await sharp(svg).png().toFile(join(outDir, icon.name));
  console.log(`✓ ${icon.name}`);
}

// Also generate apple-touch-icon (180x180, no rounding — iOS clips it)
const appleSvg = makeSvg(180, true);
await sharp(appleSvg).png().toFile(join(outDir, "apple-touch-icon.png"));
console.log("✓ apple-touch-icon.png");

console.log("Done.");
