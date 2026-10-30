import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "node:url";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? -306674912 ^ (c >>> 1) : (c >>> 1);
      }
      table[i] = c;
    }
    crc32.table = table;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, "ascii");
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

function generatePngBuffer(width, height, isMaskable = false) {
  // RGBA buffer (4 bytes per pixel)
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (1 + rowBytes));

  // Pattern matrix from favicon.svg:
  // Brand gradient colors: #6366F1 (99,102,241) to #8B5CF6 (139,92,246) to #EC4899 (236,72,153)
  const radius = isMaskable ? 0 : Math.round(width * 0.22);

  // SVG grid rects (in 512 coordinate space)
  const rects512 = [
    [184, 88, 48, 48], [232, 88, 48, 48], [280, 88, 48, 48],
    [136, 136, 48, 48], [328, 136, 48, 48],
    [136, 184, 48, 48], [328, 184, 48, 48],
    [136, 232, 48, 48], [184, 232, 48, 48], [232, 232, 48, 48], [280, 232, 48, 48], [328, 232, 48, 48],
    [136, 280, 48, 48], [328, 280, 48, 48],
    [136, 328, 48, 48], [328, 328, 48, 48],
    [136, 376, 48, 48], [328, 376, 48, 48]
  ];

  const scale = width / 512;

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      // Rounded corner check
      let inBounds = true;
      if (radius > 0) {
        let dx = 0;
        let dy = 0;
        if (x < radius) dx = radius - x;
        else if (x >= width - radius) dx = x - (width - radius - 1);
        if (y < radius) dy = radius - y;
        else if (y >= height - radius) dy = y - (height - radius - 1);

        if (dx > 0 && dy > 0) {
          if (dx * dx + dy * dy > radius * radius) {
            inBounds = false;
          }
        }
      }

      if (!inBounds) {
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0; // Transparent
        continue;
      }

      // Check if pixel falls inside the white logo glyph
      const ox = x / scale;
      const oy = y / scale;
      let isGlyph = false;
      for (const [rx, ry, rw, rh] of rects512) {
        if (ox >= rx && ox < rx + rw && oy >= ry && oy < ry + rh) {
          isGlyph = true;
          break;
        }
      }

      if (isGlyph) {
        rawData[offset++] = 255;
        rawData[offset++] = 255;
        rawData[offset++] = 255;
        rawData[offset++] = 255;
      } else {
        // Linear gradient interpolation from (0,0) to (width,height)
        const t = (x / width + y / height) / 2;
        let r, g, b;
        if (t < 0.55) {
          const f = t / 0.55;
          r = Math.round(99 + (139 - 99) * f);
          g = Math.round(102 + (92 - 102) * f);
          b = Math.round(241 + (246 - 241) * f);
        } else {
          const f = (t - 0.55) / 0.45;
          r = Math.round(139 + (236 - 139) * f);
          g = Math.round(92 + (72 - 92) * f);
          b = Math.round(246 + (153 - 246) * f);
        }
        rawData[offset++] = r;
        rawData[offset++] = g;
        rawData[offset++] = b;
        rawData[offset++] = 255;
      }
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = makeChunk("IHDR", ihdr);

  // IDAT Chunk
  const idatChunk = makeChunk("IDAT", compressed);

  // IEND Chunk
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Resolve against the script's own location so the generator works
// from any CWD (repo root locally, apps/web under pnpm on Vercel).
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/public/icons");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log("Generating icon-192.png...");
fs.writeFileSync(path.join(outDir, "icon-192.png"), generatePngBuffer(192, 192, false));

console.log("Generating icon-512.png...");
fs.writeFileSync(path.join(outDir, "icon-512.png"), generatePngBuffer(512, 512, false));

console.log("Generating icon-maskable-512.png...");
fs.writeFileSync(path.join(outDir, "icon-maskable-512.png"), generatePngBuffer(512, 512, true));

console.log("✅ All PWA icons generated successfully in apps/web/public/icons/");
