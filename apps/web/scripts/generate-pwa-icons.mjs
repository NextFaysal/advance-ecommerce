/**
 * generate-pwa-icons.mjs — PWA icon generator (zero dependencies).
 *
 * Generates the icon files referenced by `public/manifest.webmanifest`:
 *   - public/icons/icon-192.png          (192x192, purpose "any")
 *   - public/icons/icon-512.png          (512x512, purpose "any")
 *   - public/icons/icon-maskable-512.png (512x512, purpose "maskable")
 *   - public/favicon.svg                 (browser favicon, same artwork)
 *
 * Artwork (Admin Dashboard Design Spec): brand gradient at 135deg,
 * #6366F1 -> #8B5CF6 (55%) -> #EC4899, with a bold white "A" glyph
 * (5x7 pixel font defined below). Standard icons get rounded corners
 * with transparency outside the corner radius; the maskable icon is
 * full-bleed with the glyph kept inside the central safe zone.
 *
 * PNGs are encoded with a minimal hand-written encoder (signature +
 * IHDR + IDAT + IEND, CRC32, filter-0 rows, zlib deflate from
 * `node:zlib`). Uses ONLY Node.js built-ins — no packages, no
 * downloaded assets. Output is deterministic: run it any time with
 *   node scripts/generate-pwa-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(webRoot, "public");
const iconsDir = join(publicDir, "icons");

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

/** Brand gradient stops: [offset, [r, g, b]] — 135deg per the design spec. */
const GRADIENT_STOPS = [
  { t: 0.0, c: [0x63, 0x66, 0xf1] }, // #6366F1
  { t: 0.55, c: [0x8b, 0x5c, 0xf6] }, // #8B5CF6
  { t: 1.0, c: [0xec, 0x48, 0x99] }, // #EC4899
];

function gradientAt(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < GRADIENT_STOPS.length; i++) {
    const prev = GRADIENT_STOPS[i - 1];
    const next = GRADIENT_STOPS[i];
    if (x <= next.t) {
      const f = (x - prev.t) / (next.t - prev.t);
      return [
        prev.c[0] + (next.c[0] - prev.c[0]) * f,
        prev.c[1] + (next.c[1] - prev.c[1]) * f,
        prev.c[2] + (next.c[2] - prev.c[2]) * f,
      ];
    }
  }
  return [...GRADIENT_STOPS[GRADIENT_STOPS.length - 1].c];
}

/** 5x7 pixel font for the letter "A" (1 = painted). */
const GLYPH_A = [
  "01110",
  "10001",
  "10001",
  "11111",
  "10001",
  "10001",
  "10001",
];

/** CSS 135deg gradient axis: pointing to the bottom-right corner. */
const AXIS_X = Math.SQRT1_2;
const AXIS_Y = Math.SQRT1_2;

function gradientT(x, y, size) {
  const p = (x - size / 2) * AXIS_X + (y - size / 2) * AXIS_Y;
  return p / (size * (AXIS_X + AXIS_Y)) + 0.5;
}

function insideRoundedRect(x, y, size, radius) {
  if (radius <= 0) return true;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Render one icon to an RGBA pixel buffer.
 * 4x4 supersampling per output pixel keeps the glyph and corner edges smooth.
 * `maskable`: full-bleed square, glyph shrunk into the central safe zone.
 */
function renderIcon(size, { maskable }) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);

  // Glyph box: standard icons get a large glyph; the maskable glyph stays
  // well inside the central 80% safe circle (bbox corner at ~0.36*size
  // from centre, safe radius is 0.40*size).
  const cell = maskable
    ? Math.min((size * 0.42) / 5, (size * 0.58) / 7)
    : Math.min((size * 0.58) / 5, (size * 0.66) / 7);
  const glyphW = cell * 5;
  const glyphH = cell * 7;
  const glyphX = (size - glyphW) / 2;
  const glyphY = (size - glyphH) / 2;
  const radius = maskable ? 0 : size * 0.225;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (!insideRoundedRect(px, py, size, radius)) continue;
          let col = gradientAt(gradientT(px, py, size));
          if (px >= glyphX && px < glyphX + glyphW && py >= glyphY && py < glyphY + glyphH) {
            const colIdx = Math.floor((px - glyphX) / cell);
            const rowIdx = Math.floor((py - glyphY) / cell);
            if (GLYPH_A[rowIdx][colIdx] === "1") col = [255, 255, 255];
          }
          rSum += col[0];
          gSum += col[1];
          bSum += col[2];
          covered++;
        }
      }
      const i = (y * size + x) * 4;
      if (covered === 0) {
        rgba[i + 3] = 0; // fully transparent (outside rounded corner)
      } else {
        rgba[i] = Math.round(rSum / covered);
        rgba[i + 1] = Math.round(gSum / covered);
        rgba[i + 2] = Math.round(bSum / covered);
        rgba[i + 3] = Math.round((covered / (SS * SS)) * 255);
      }
    }
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA, bit depth 8, filter 0, no interlace)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = truecolour with alpha (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    raw[row * stride] = 0; // filter type 0 (None) for every row
    rgba.copy(raw, row * stride + 1, row * width * 4, (row + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// favicon.svg — same artwork as the PNGs, built from the same glyph grid
// ---------------------------------------------------------------------------

function buildFaviconSvg() {
  const size = 512;
  const cell = 48;
  const glyphW = cell * 5;
  const glyphH = cell * 7;
  const x0 = (size - glyphW) / 2;
  const y0 = (size - glyphH) / 2;
  const blocks = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (GLYPH_A[row][col] === "1") {
        blocks.push(
          `<rect x="${x0 + col * cell}" y="${y0 + row * cell}" width="${cell}" height="${cell}"/>`,
        );
      }
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `  <defs>`,
    `    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">`,
    `      <stop offset="0" stop-color="#6366F1"/>`,
    `      <stop offset="0.55" stop-color="#8B5CF6"/>`,
    `      <stop offset="1" stop-color="#EC4899"/>`,
    `    </linearGradient>`,
    `  </defs>`,
    `  <rect width="${size}" height="${size}" rx="115" fill="url(#brand)"/>`,
    `  <g fill="#FFFFFF">`,
    ...blocks.map((b) => `    ${b}`),
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ICONS = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

mkdirSync(iconsDir, { recursive: true });

for (const icon of ICONS) {
  const png = encodePng(icon.size, icon.size, renderIcon(icon.size, icon));
  const path = join(iconsDir, icon.file);
  writeFileSync(path, png);
  console.log(`wrote public/icons/${icon.file} (${icon.size}x${icon.size}, ${png.length} bytes)`);
}

const faviconPath = join(publicDir, "favicon.svg");
const svg = buildFaviconSvg();
writeFileSync(faviconPath, svg, "utf8");
console.log(`wrote public/favicon.svg (${Buffer.byteLength(svg, "utf8")} bytes)`);
