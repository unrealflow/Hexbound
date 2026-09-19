/** Quantify hex-boundary luma jumps vs interior jumps on canvas screenshots.
 * Usage: node scripts/seam-metric.mjs [glob...]
 * Default: docs/shots/*-canvas.png (skips _diag).
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { inflateSync } from 'zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'docs', 'shots');

function decodePng(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('not png');
  let off = 8;
  let w = 0, h = 0, depth = 0, ctype = 0;
  const idats = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idats));
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : 0;
  if (depth !== 8 || bpp === 0) throw new Error(`unsupported png ${depth}/${ctype}`);
  const stride = w * bpp;
  const luma = new Float32Array(w * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? raw.subarray(p - stride * 2 - 1, p - stride - 1) : null;
    const recon = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? recon[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pval = a + b - c;
        const pa = Math.abs(pval - a);
        const pb = Math.abs(pval - b);
        const pc = Math.abs(pval - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      recon[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const o = x * bpp;
      const r = recon[o] / 255;
      const g = bpp > 1 ? recon[o + 1] / 255 : r;
      const bch = bpp > 2 ? recon[o + 2] / 255 : r;
      luma[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * bch;
    }
  }
  return { w, h, luma };
}

function hexAxialDist(px, py, ox, oy, r) {
  const x = (px - ox) / r;
  const y = (py - oy) / r;
  const q = (Math.sqrt(3) / 3) * x - (1 / 3) * y;
  const rr = (2 / 3) * y;
  const s = -q - rr;
  const qn = Math.round(q);
  const rn = Math.round(rr);
  const sn = Math.round(s);
  return (Math.abs(qn - q) + Math.abs(rn - rr) + Math.abs(sn - s)) * 0.5;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

function metricOne(luma, w, h) {
  const x0 = Math.floor(w * 0.08);
  const x1 = Math.floor(w * 0.92);
  const y0 = Math.floor(h * 0.12);
  const y1 = Math.floor(h * 0.88);
  const step = 2;
  let best = null;
  const radii = [18, 24, 32, 42, 56];
  const origins = [0, 0.33, 0.5];
  for (const r of radii) {
    for (const oxf of origins) {
      for (const oyf of origins) {
        const ox = x0 + r * oxf;
        const oy = y0 + r * oyf;
        const edge = [];
        const inner = [];
        for (let y = y0; y < y1; y += step) {
          for (let x = x0; x < x1; x += step) {
            const L = luma[y * w + x];
            if (L < 0.12 || L > 0.82) continue;
            const d = hexAxialDist(x, y, ox, oy, r);
            const nx = Math.min(w - 1, x + 1);
            const jump = Math.abs(L - luma[y * w + nx]);
            if (d > 0.40 && d < 0.52) edge.push(jump);
            else if (d < 0.20) inner.push(jump);
          }
        }
        if (edge.length < 80 || inner.length < 80) continue;
        edge.sort((a, b) => a - b);
        inner.sort((a, b) => a - b);
        const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
        const p95e = percentile(edge, 95);
        const p95i = percentile(inner, 95);
        const ratio = p95i > 1e-6 ? p95e / p95i : p95e;
        const meanRatio = mean(inner) > 1e-6 ? mean(edge) / mean(inner) : mean(edge);
        if (!best || ratio > best.ratio) {
          best = {
            r,
            nEdge: edge.length,
            nInner: inner.length,
            meanEdge: +mean(edge).toFixed(4),
            meanInner: +mean(inner).toFixed(4),
            p95Edge: +p95e.toFixed(4),
            p95Inner: +p95i.toFixed(4),
            maxEdge: +edge[edge.length - 1].toFixed(4),
            maxInner: +inner[inner.length - 1].toFixed(4),
            ratioP95: +ratio.toFixed(3),
            ratioMean: +meanRatio.toFixed(3),
            ratio,
          };
        }
      }
    }
  }
  return best;
}

const names = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith('-canvas.png') && !f.startsWith('_diag'))
);
const rows = [];
for (const name of names) {
  const fp = name.includes('/') || name.includes('\\') ? name : join(dir, name);
  const { w, h, luma } = decodePng(readFileSync(fp));
  const m = metricOne(luma, w, h);
  rows.push({ file: basename(fp), w, h, ...m });
}
console.log(JSON.stringify(rows, null, 2));
