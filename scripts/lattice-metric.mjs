/** Hex-lattice artifact metric.
 *
 *  Looks straight down at the terrain with an orthographic camera, maps every
 *  sampled pixel back to world XZ (the ray is vertical, so the ground-plane hit
 *  is exact and occlusion-free), converts it to fractional axial coordinates and
 *  bins luminance by the distance to the containing cell's centre. The shader's
 *  data lattice is the hex-centre lattice, so a per-cell plateau or rim line
 *  shows up as a systematic slope in luma(d), and per-cell blocks show up as a
 *  high between-cell variance share.
 *
 *  Reports:
 *   plateauSpread   (max-min)/mean of the luma-bin means over the hex radial
 *                   coordinate; 0 = no lattice structure in luminance.
 *   rimMinusInterior normalised luma at the cell rim minus the cell interior;
 *                   a pale hex border line makes this positive.
 *   stepAcross/Within  mean |dLuma| between horizontally adjacent samples that
 *                   straddle a cell border vs the ones inside one cell; their
 *                   ratio isolates the lattice step from ordinary texture detail.
 *   cellVarRatio    between-cell variance / total variance of luma grouped by
 *                   cell; a per-cell flat paint gives ~1.
 *   hashBinSpread   same "spread of bin means" statistic with bins assigned by a
 *                   hash of the pixel index: the noise floor of the estimator.
 *
 *  Usage: node scripts/lattice-metric.mjs [--tag name] [--port 5173] [--cx X --cz Z --ortho S]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'shots');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PORT = Number(argOf('--port', 5173));
const TAG = argOf('--tag', 'lattice');
const CX = Number(argOf('--cx', 0));
const CZ = Number(argOf('--cz', 0));
const ORTHO = Number(argOf('--ortho', 14));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300));
});
await page.goto(`http://127.0.0.1:${PORT}/?t=` + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
if (argv.includes('--nodisp')) await page.addInitScript(() => { window.__hbNoDisp = true; });
await page.waitForFunction(
  () => {
    const h = window.__hexbound;
    return !!h && h.chunks.meshes.every((m) => m.isReady(true));
  },
  null,
  { timeout: 180000, polling: 500 },
);
await page.waitForTimeout(1000);

await page.evaluate(
  ({ cx, cz, size }) => {
    const h = window.__hexbound;
    const V = h.camera.position.constructor;
    // Low height: the orthographic projection does not depend on it, but the
    // fog term does, and heavy fog would wash out everything being measured.
    h.camera.position.set(cx, 12, cz);
    h.camera.setTarget(new V(cx, 0, cz));
    // The render loop re-applies the panel state every frame, so fog has to be
    // switched off through the panel rather than by poking the uniform.
    const fog = document.querySelector('#dbg-fog');
    if (fog) {
      fog.checked = false;
      fog.dispatchEvent(new Event('change'));
    }
    if (window.__hbNoDisp) {
      const d = document.querySelector('#dbg-disp');
      if (d) {
        d.checked = false;
        d.dispatchEvent(new Event('change'));
      }
    }
    const a = h.engine.getAspectRatio(h.camera);
    h.camera.orthoTop = size;
    h.camera.orthoBottom = -size;
    h.camera.orthoLeft = -size * a;
    h.camera.orthoRight = size * a;
    window.__hb = {
      setUniform(name, value) {
        h.chunks.material.setFloat(name, value);
      },
      measure(stride) {
        const c = document.querySelector('#renderCanvas');
        const sx = c.width / c.clientWidth;
        const sy = c.height / c.clientHeight;
        const cv = document.createElement('canvas');
        cv.width = c.width;
        cv.height = c.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(c, 0, 0);
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width;
        const H = cv.height;
        const SQ3 = Math.sqrt(3);
        const toAxial = (x, z) => ({ q: (SQ3 / 3) * x - z / 3, r: (2 / 3) * z });
        const rnd = (q, r) => {
          const s = -q - r;
          let rq = Math.round(q);
          let rr = Math.round(r);
          const rs = Math.round(s);
          const dq = Math.abs(rq - q);
          const dr = Math.abs(rr - r);
          const ds = Math.abs(rs - s);
          if (dq > dr && dq > ds) rq = -rr - rs;
          else if (dr > ds) rr = -rq - rs;
          return { q: rq, r: rr };
        };
        const worldAt = (px, py) => {
          const ray = h.scene.createPickingRay(px, py, null, h.camera);
          if (Math.abs(ray.direction.y) < 1e-6) return null;
          const t = -ray.origin.y / ray.direction.y;
          if (t < 0) return null;
          return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
        };
        const map = h.map;
        const NB = 10;
        const bin = [];
        const hash = [];
        for (let i = 0; i < NB; i++) {
          bin.push({ n: 0, s: 0, r: 0, g: 0, b: 0 });
          hash.push({ n: 0, s: 0 });
        }
        const cells = new Map();
        let allN = 0;
        let allS = 0;
        let allS2 = 0;
        let sameN = 0;
        let sameS = 0;
        let crossN = 0;
        let crossS = 0;
        const pxPer = { x: 0, z: 0 };
        let first = true;
        let last = null;
        for (let py = 0; py < H; py += stride) {
          let prev = null;
          for (let px = 0; px < W; px += stride) {
            const wp = worldAt(px / sx, py / sy);
            if (!wp) continue;
            if (first) {
              const w2 = worldAt(Math.min(W - 1, px + stride) / sx, py / sy);
              const w3 = worldAt(px / sx, Math.min(H - 1, py + stride) / sy);
              if (w2 && w3) {
                pxPer.x = stride / (w2.x - wp.x);
                pxPer.z = stride / (w3.z - wp.z);
              }
              last = wp;
              first = false;
            }
            const af = toAxial(wp.x, wp.z);
            const nr = rnd(af.q, af.r);
            const cell = map.get(nr.q, nr.r);
            if (!cell) {
              prev = null;
              continue;
            }
            const dq = af.q - nr.q;
            const dr = af.r - nr.r;
            const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(-dq - dr)) / 2;
            const t = Math.min(0.999, dist / 0.6667);
            const i = (py * W + px) * 4;
            const yy = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const bi = Math.min(NB - 1, Math.floor(t * NB));
            const B = bin[bi];
            B.n++;
            B.s += yy;
            B.r += d[i];
            B.g += d[i + 1];
            B.b += d[i + 2];
            const hi = Math.floor((((px * 1103515245 + py * 12345) >>> 9) % NB));
            hash[hi].n++;
            hash[hi].s += yy;
            allN++;
            allS += yy;
            allS2 += yy * yy;
            const key = nr.q * 1000 + nr.r;
            let C = cells.get(key);
            if (!C) {
              C = { n: 0, s: 0, s2: 0 };
              cells.set(key, C);
            }
            C.n++;
            C.s += yy;
            C.s2 += yy * yy;
            if (prev) {
              const dl = Math.abs(yy - prev.luma);
              if (prev.q === nr.q && prev.r === nr.r) {
                sameN++;
                sameS += dl;
              } else {
                crossN++;
                crossS += dl;
              }
            }
            prev = { q: nr.q, r: nr.r, luma: yy };
          }
        }
        const meanOf = (B) => (B.n ? B.s / B.n : null);
        const binMeans = bin.map(meanOf).filter((m) => m !== null);
        const hashMeans = hash.map(meanOf).filter((m) => m !== null);
        const spread = (arr) => (Math.max(...arr) - Math.min(...arr)) / Math.max(arr.reduce((a, b) => a + b, 0) / arr.length, 1e-6);
        const globalMean = allS / Math.max(allN, 1);
        const globalVar = Math.max(allS2 / Math.max(allN, 1) - globalMean * globalMean, 0);
        let interN = 0;
        let interS = 0;
        let rimN = 0;
        let rimS = 0;
        for (let i = 0; i < NB; i++) {
          if (!bin[i].n) continue;
          if (i <= 1) {
            interN += bin[i].n;
            interS += bin[i].s;
          }
          if (i >= NB - 2) {
            rimN += bin[i].n;
            rimS += bin[i].s;
          }
        }
        let betweenS = 0;
        let withinS = 0;
        let nn = 0;
        for (const C of cells.values()) {
          const m = C.s / C.n;
          betweenS += C.n * (m - globalMean) * (m - globalMean);
          withinS += Math.max(C.s2 - C.s * C.s / C.n, 0);
          nn++;
        }
        const betweenVar = betweenS / Math.max(allN, 1);
        const withinVar = withinS / Math.max(allN, 1);
        const same = sameS / Math.max(sameN, 1);
        const cross = crossS / Math.max(crossN, 1);
        return {
          samples: allN,
          cells: nn,
          pxPerWorld: [+pxPer.x.toFixed(2), +pxPer.z.toFixed(2)],
          lumaMean: +globalMean.toFixed(3),
          lumaSd: +Math.sqrt(globalVar).toFixed(3),
          binMean: bin.map((B) => (B.n ? +meanOf(B).toFixed(2) : null)),
          binRgb: bin.map((B) => (B.n ? [+(B.r / B.n).toFixed(1), +(B.g / B.n).toFixed(1), +(B.b / B.n).toFixed(1)] : null)),
          plateauSpread: +spread(binMeans).toFixed(4),
          rimMinusInterior: +(((rimS / Math.max(rimN, 1)) - (interS / Math.max(interN, 1))) / Math.max(globalMean, 1e-6)).toFixed(4),
          stepAcross: +cross.toFixed(3),
          stepWithin: +same.toFixed(3),
          stepRatio: +(cross / Math.max(same, 1e-6)).toFixed(3),
          cellVarRatio: +(betweenVar / Math.max(betweenVar + withinVar, 1e-9)).toFixed(4),
          hashBinSpread: +spread(hashMeans).toFixed(4),
        };
      },
    };
  },
  { cx: CX, cz: CZ, size: ORTHO },
);

// The render loop applies camera and panel changes on the next frame; sampling
// before that would measure the previous frame against the new camera mapping.
const settle = () =>
  page.evaluate(
    () =>
      new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)));
      }),
  );
await settle();
const res = await page.evaluate(() => window.__hb.measure(2));
console.log(TAG, JSON.stringify(res, null, 1));

const dataUrl = await page.evaluate(() => document.querySelector('#renderCanvas').toDataURL('image/png'));
writeFileSync(
  join(OUT, `_${TAG}-lattice-topdown.png`),
  Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'),
);
await browser.close();
