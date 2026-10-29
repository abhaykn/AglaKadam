/**
 * Generates the PWA icon set from the brand mark.
 * Run with `npm run icons` after changing the mark; the output is committed under `public/`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const steps = (scale, offset) => {
  const points = [
    [9, 29],
    [9, 23.5],
    [16, 23.5],
    [16, 17.5],
    [23, 17.5],
    [23, 11.5],
    [31, 11.5],
    [31, 29],
  ];
  return points.map(([x, y]) => `${x * scale + offset},${y * scale + offset}`).join(' ');
};

/** Rounded tile used for regular icons and the favicon. */
const roundedMark = (size) => {
  const scale = size / 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7CC8F2"/>
      <stop offset="1" stop-color="#2D86B4"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${10 * scale}" fill="url(#tile)"/>
  <polygon points="${steps(scale, 0)}" fill="#04293F" stroke="#04293F" stroke-width="${1.5 * scale}" stroke-linejoin="round"/>
  <circle cx="${18.9 * scale}" cy="${12.2 * scale}" r="${2.6 * scale}" fill="#FFD27A"/>
</svg>`;
};

/** Full-bleed square with the mark inside the maskable safe zone (inner 80 %). */
const maskableMark = (size) => {
  const inner = size * 0.62;
  const scale = inner / 40;
  const offset = (size - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7CC8F2"/>
      <stop offset="1" stop-color="#2D86B4"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#tile)"/>
  <polygon points="${steps(scale, offset)}" fill="#04293F" stroke="#04293F" stroke-width="${1.5 * scale}" stroke-linejoin="round"/>
  <circle cx="${18.9 * scale + offset}" cy="${12.2 * scale + offset}" r="${2.6 * scale}" fill="#FFD27A"/>
</svg>`;
};

const outputs = [
  { file: 'icons/icon-192.png', svg: roundedMark(192) },
  { file: 'icons/icon-512.png', svg: roundedMark(512) },
  { file: 'icons/icon-maskable-512.png', svg: maskableMark(512) },
  { file: 'apple-touch-icon.png', svg: maskableMark(180) },
  { file: 'favicon-32.png', svg: roundedMark(32) },
];

await mkdir(resolve(publicDir, 'icons'), { recursive: true });

for (const { file, svg } of outputs) {
  const target = resolve(publicDir, file);
  await mkdir(dirname(target), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(target);
}

await writeFile(resolve(publicDir, 'favicon.svg'), roundedMark(40));
process.stdout.write(`Generated ${outputs.length + 1} icon files in ${publicDir}\n`);
