/**
 * Génère les icônes PNG de la PWA (cible de fléchettes dessinée pixel par pixel,
 * sans dépendance externe).  Usage : `node scripts/gen-icons.mjs`
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'icons');

const CREAM = [242, 239, 230];
const DARK = [20, 24, 29];
const RED = [224, 75, 60];
const GREEN = [63, 185, 107];
const BG = [14, 18, 22];

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function writePng(path, size, pixels) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filtre « none »
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      raw[offset++] = pixels[i];
      raw[offset++] = pixels[i + 1];
      raw[offset++] = pixels[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // profondeur
  ihdr[9] = 2;  // RVB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`${path} (${size}×${size}, ${(png.length / 1024).toFixed(1)} ko)`);
}

/** Couleur de la cible en coordonnées normalisées (d = rayon, a = angle). */
function boardColor(d, a) {
  if (d > 1) return BG;
  if (d <= 0.055) return RED;
  if (d <= 0.115) return GREEN;
  const sector = Math.floor(((a + Math.PI / 20 + Math.PI * 4) / (Math.PI * 2)) * 20) % 20;
  const light = sector % 2 === 0;
  const base = light ? CREAM : DARK;
  const ring = light ? RED : GREEN;
  if (d > 0.5 && d <= 0.58) return ring;   // triples
  if (d > 0.9 && d <= 0.98) return ring;   // doubles
  if (d > 0.98) return DARK;               // bordure extérieure
  return base;
}

function render(size, scale) {
  const pixels = Buffer.alloc(size * size * 3);
  const center = size / 2;
  const radius = (size / 2) * scale;
  const SS = 3; // sur-échantillonnage
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - center;
          const py = y + (sy + 0.5) / SS - center;
          const color = boardColor(Math.hypot(px, py) / radius, Math.atan2(py, px));
          r += color[0]; g += color[1]; b += color[2];
        }
      }
      const i = (y * size + x) * 3;
      const n = SS * SS;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
    }
  }
  return pixels;
}

mkdirSync(OUT, { recursive: true });
writePng(join(OUT, 'icon-192.png'), 192, render(192, 0.94));
writePng(join(OUT, 'icon-512.png'), 512, render(512, 0.94));
writePng(join(OUT, 'icon-180.png'), 180, render(180, 0.94));
writePng(join(OUT, 'icon-maskable-512.png'), 512, render(512, 0.72));
