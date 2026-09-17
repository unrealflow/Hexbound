/** Synthesize small tiling noise/detail textures (no photo albedos). */
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public', 'tex');
mkdirSync(OUT, { recursive: true });

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hash2(x, y) {
  let n = Math.imul(x * 374761393, 668265263) ^ Math.imul(y, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function valueNoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, oct = 5) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * valueNoise(x * f, y * f);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

function make(w, h, fn) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y, w, h);
      const i = (y * w + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return encodePNG(w, h, rgba);
}

// Seamless wrap helpers
function wrapFbm(x, y, period, oct) {
  // sample at wrap by blending 4 corners of torus — good enough for small tiles
  const u = x / period, v = y / period;
  const n00 = fbm(u * 4, v * 4, oct);
  const n10 = fbm((u + 1) * 4, v * 4, oct);
  const n01 = fbm(u * 4, (v + 1) * 4, oct);
  const n11 = fbm((u + 1) * 4, (v + 1) * 4, oct);
  const wu = smooth(u % 1), wv = smooth(v % 1);
  // Better: classic seamless via 4-corner domain
  const sx = x % period, sy = y % period;
  const a = fbm(sx * 0.08, sy * 0.08, oct);
  const b = fbm((sx - period) * 0.08, sy * 0.08, oct);
  const c = fbm(sx * 0.08, (sy - period) * 0.08, oct);
  const d = fbm((sx - period) * 0.08, (sy - period) * 0.08, oct);
  const tx = smooth(sx / period), ty = smooth(sy / period);
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

const SIZE = 256;

// 1) grayscale value noise (R=noise, G=fbm, B=ridge, A=1)
writeFileSync(join(OUT, 'noise.png'), make(SIZE, SIZE, (x, y, w) => {
  const n = wrapFbm(x, y, w, 1);
  const f = wrapFbm(x * 1.7 + 17, y * 1.7, w, 5);
  const ridge = 1 - Math.abs(f * 2 - 1);
  return [n * 255, f * 255, ridge * ridge * 255, 255];
}));

// 2) grass detail (green mottling + blade streaks in alpha)
writeFileSync(join(OUT, 'grass_detail.png'), make(SIZE, SIZE, (x, y, w) => {
  const f = wrapFbm(x, y, w, 4);
  const blade = Math.abs(Math.sin((x + f * 40) * 0.55 + y * 0.08));
  const r = 40 + f * 50 + blade * 20;
  const g = 70 + f * 90 + blade * 40;
  const b = 25 + f * 30;
  return [r, g, b, 180 + blade * 60];
}));

// 3) rock detail (strata + cracks)
writeFileSync(join(OUT, 'rock_detail.png'), make(SIZE, SIZE, (x, y, w) => {
  const f = wrapFbm(x, y, w, 5);
  const band = Math.floor((y + f * 18) / 12) % 4;
  const crack = wrapFbm(x * 2.2, y * 0.4, w, 3);
  const shade = 70 + band * 18 + f * 40 - (crack > 0.62 ? 35 : 0);
  return [shade * 1.05, shade * 0.95, shade * 0.88, 255];
}));

// 4) sand detail (warm dunes ripples)
writeFileSync(join(OUT, 'sand_detail.png'), make(SIZE, SIZE, (x, y, w) => {
  const f = wrapFbm(x, y, w, 3);
  const rip = Math.sin((x * 0.35 + y * 0.08) + f * 6);
  const r = 180 + rip * 25 + f * 30;
  const g = 140 + rip * 15 + f * 25;
  const b = 70 + rip * 8 + f * 15;
  return [r, g, b, 255];
}));

// 5) water normal-ish (RG = xy offset encoded 0..255 around 128, B=height)
writeFileSync(join(OUT, 'water_normal.png'), make(SIZE, SIZE, (x, y, w) => {
  const e = 1.0;
  const h = (xx, yy) => wrapFbm(xx, yy, w, 4);
  const c = h(x, y);
  const dx = (h(x + e, y) - h(x - e, y)) * 4;
  const dy = (h(x, y + e) - h(x, y - e)) * 4;
  return [128 + dx * 80, 128 + dy * 80, 128 + (c - 0.5) * 100, 255];
}));

// 6) canopy mottling
writeFileSync(join(OUT, 'canopy_detail.png'), make(SIZE, SIZE, (x, y, w) => {
  const f = wrapFbm(x, y, w, 4);
  const cell = wrapFbm(x * 0.5 + 9, y * 0.5, w, 2);
  const dark = f * 0.55 + cell * 0.45;
  const r = 20 + dark * 40;
  const g = 55 + dark * 110;
  const b = 18 + dark * 35;
  return [r, g, b, 200 + dark * 40];
}));

console.log('Wrote detail textures to', OUT);
