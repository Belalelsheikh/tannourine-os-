// Generates public/icon-192.png, icon-512.png, icon-maskable-512.png
// Run: npm run icons   (needs the `sharp` devDependency)
//
// Pure vector paths only — no text. Rendering Arabic glyphs through librsvg
// depends on host fonts, which would make the icon differ per machine.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public');

const INK = '#10222E';
const PAPER = '#EDF0EE';
const OK = '#0E6E63';

/** Droplet + waterline mark. `inset` shrinks the mark for the maskable safe zone. */
const svg = (size, inset) => {
  const s = size;
  const c = s / 2;
  const r = (s / 2) * inset;          // mark radius
  const dropTop = c - r * 0.82;
  const dropBottom = c + r * 0.55;
  const dropHalf = r * 0.62;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="${INK}"/>
  <path d="M ${c} ${dropTop}
           C ${c + dropHalf} ${c - r * 0.05}, ${c + dropHalf} ${dropBottom}, ${c} ${dropBottom}
           C ${c - dropHalf} ${dropBottom}, ${c - dropHalf} ${c - r * 0.05}, ${c} ${dropTop} Z"
        fill="${PAPER}"/>
  <rect x="${c - r * 0.44}" y="${c + r * 0.18}" width="${r * 0.88}" height="${r * 0.1}" fill="${OK}"/>
  <rect x="${c - r * 0.30}" y="${c + r * 0.34}" width="${r * 0.60}" height="${r * 0.1}" fill="${OK}"/>
</svg>`;
};

await mkdir(outDir, { recursive: true });

const jobs = [
  ['icon-192.png', 192, 0.78],
  ['icon-512.png', 512, 0.78],
  // maskable: mark confined to the inner ~62% so no platform mask clips it
  ['icon-maskable-512.png', 512, 0.56],
];

for (const [name, size, inset] of jobs) {
  const buf = await sharp(Buffer.from(svg(size, inset))).png().toBuffer();
  await writeFile(join(outDir, name), buf);
  console.log('wrote', name, `${size}x${size}`);
}

// favicon for the browser tab
await writeFile(join(outDir, 'favicon.svg'), svg(64, 0.78));
console.log('wrote favicon.svg');
