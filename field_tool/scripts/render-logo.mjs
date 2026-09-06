// Render field_tool/assets/logo.svg into the three PNG sizes the launcher /
// splash need. Run with: `node scripts/render-logo.mjs` from field_tool.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(resolve(root, 'assets/logo.svg'));
const targets = [
  { out: 'assets/icon.png',         size: 1024, pad: 0,    bg: '#0F6E6E' },
  { out: 'assets/adaptive-icon.png', size: 1024, pad: 0.34, bg: '#0F6E6E' },
  { out: 'assets/splash-icon.png',  size: 512,  pad: 0.30, bg: null    },
];
for (const t of targets) {
  const inner = Math.round(t.size * (1 - t.pad));
  const logo = await sharp(svg).resize(inner, inner).png().toBuffer();
  let canvas;
  if (t.bg) {
    canvas = await sharp({ create: { width: t.size, height: t.size, channels: 4, background: t.bg } })
      .composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
  } else {
    canvas = await sharp({ create: { width: t.size, height: t.size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
  }
  await sharp(canvas).toFile(resolve(root, t.out));
  console.log(t.out, t.size, 'x', t.size);
}