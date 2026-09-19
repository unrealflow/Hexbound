/** Shore-line profile metric: is there a bright rim drawn along the coast?
 *  Usage: node scripts/shore-profile.mjs [--port 5173] [--zoom 0|1] [--gate]
 *
 *  Method: capture the same camera three times — uDbgField=7 (waterW as
 *  greyscale, so terrain pixels are colourless and the sky keeps its blue),
 *  uDbgField=0 (normal shading) and uDbgField=9 (albedo luma, i.e. paint with
 *  no lighting or fog). Classify water/land from the mask, find every water
 *  pixel with a land neighbour (a coast crossing), walk the waterW gradient
 *  outwards and sample luma at pixel offsets -20..+20. A pale shelf ramps
 *  monotonically; a drawn line peaks inside the transition band. Comparing the
 *  lit and albedo profiles separates paint from lighting (specular, fog).
 *
 *  Reported per pass: meanProfile (offset -20 = inland), rimAboveBoth = peak
 *  inside +/-2 px minus the brighter shoulder (>0.01 luma ~ 2.5/255 reads as a
 *  white line; shipping target <=0.01), shelfOverLand = mean luma 3..12 px
 *  offshore minus 3..12 px inland.
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const PORT = Number(argOf('--port', 5173));
const ZOOM = Number(argOf('--zoom', 0));
const GATE = argv.includes('--gate');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://127.0.0.1:${PORT}/?t=` + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(
  () => {
    const h = window.__hexbound;
    return !!h && h.chunks.meshes.every((m) => m.isReady(true));
  },
  null,
  { timeout: 180000, polling: 500 },
);
await page.waitForTimeout(1200);

if (ZOOM > 0) {
  await page.mouse.wheel(0, -1400 * ZOOM);
  await page.waitForTimeout(900);
}

await page.evaluate(() => {
  const h = window.__hexbound;
  const shots = {};
  window.__sp = {
    async capture(mode) {
      h.chunks.material.setFloat('uDbgField', mode);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80))));
      const c = document.querySelector('#renderCanvas');
      const cv = document.createElement('canvas');
      cv.width = c.width;
      cv.height = c.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(c, 0, 0);
      shots[mode] = ctx.getImageData(0, 0, cv.width, cv.height);
    },
    analyze() {
      const mask = shots[7].data;
      const W = shots[7].width;
      const H = shots[7].height;
      const idx = (x, y) => (y * W + x) * 4;
      const isSky = (x, y) => {
        const i = idx(x, y);
        return mask[i + 2] - mask[i] > 8 && mask[i + 2] - mask[i + 1] > 4;
      };
      const waterW = (x, y) => mask[idx(x, y)] / 255;
      const offsets = [];
      for (let t = -20; t <= 20; t++) offsets.push(t);

      const run = (pass) => {
        const px = shots[pass].data;
        const luma = (x, y) => {
          const i = idx(x, y);
          return (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
        };
        const sum = new Float64Array(offsets.length);
        const cnt = new Float64Array(offsets.length);
        let crossings = 0;
        let rimCount = 0;
        let rimMax = 0;
        let shelfSum = 0;
        for (let y = 21; y < H - 21; y++) {
          for (let x = 21; x < W - 21; x++) {
            if (isSky(x, y)) continue;
            const w = waterW(x, y);
            if (w < 0.6 || w > 0.92) continue;
            const gx = (waterW(x + 1, y) - waterW(x - 1, y)) * 0.5;
            const gy = (waterW(x, y + 1) - waterW(x, y - 1)) * 0.5;
            const g = Math.hypot(gx, gy);
            if (g < 0.02) continue;
            const dx = gx / g;
            const dy = gy / g;
            let ok = true;
            for (const t of offsets) {
              const sx = Math.round(x + dx * t);
              const sy = Math.round(y + dy * t);
              if (sx < 2 || sy < 2 || sx > W - 3 || sy > H - 3 || isSky(sx, sy)) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            crossings++;
            const prof = new Float64Array(offsets.length);
            for (let k = 0; k < offsets.length; k++) {
              const sx = Math.round(x + dx * offsets[k]);
              const sy = Math.round(y + dy * offsets[k]);
              const v = luma(sx, sy);
              prof[k] = v;
              sum[k] += v;
              cnt[k] += 1;
            }
            const at = (t) => prof[offsets.indexOf(t)];
            let peak = -1;
            for (let t = -2; t <= 2; t++) peak = Math.max(peak, at(t));
            const shoulder = Math.max(at(-8), at(-6), at(-4), at(8), at(6), at(4));
            const above = peak - shoulder;
            if (above > rimMax) rimMax = above;
            if (above > 0.01) rimCount++;
            let sh = 0;
            for (const t of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) sh += at(t);
            let ld = 0;
            for (const t of [-3, -4, -5, -6, -7, -8, -9, -10, -11, -12]) ld += at(t);
            shelfSum += (sh - ld) / 10;
          }
        }
        return {
          crossings,
          meanProfile: offsets.map((t, k) => +(cnt[k] ? sum[k] / cnt[k] : 0).toFixed(4)),
          rimAboveBothMax: +rimMax.toFixed(4),
          rimPixelShare: crossings ? +(rimCount / crossings).toFixed(4) : 0,
          shelfOverLand: crossings ? +(shelfSum / crossings).toFixed(4) : 0,
        };
      };
      return { lit: run(0), albedo: run(9) };
    },
  };
});

await page.evaluate(() => window.__sp.capture(7));
await page.evaluate(() => window.__sp.capture(0));
await page.evaluate(() => window.__sp.capture(9));
const report = await page.evaluate(() => window.__sp.analyze());
await page.evaluate(() => window.__hexbound.chunks.material.setFloat('uDbgField', 0));
console.log(JSON.stringify({ zoom: ZOOM, ...report }, null, 2));
await browser.close();

if (GATE) {
  const bad = [];
  if (report.lit.crossings < 200) bad.push(`too few crossings (${report.lit.crossings})`);
  for (const pass of ['lit', 'albedo']) {
    if (report[pass].rimAboveBothMax > 0.01) {
      bad.push(`${pass}.rimAboveBothMax ${report[pass].rimAboveBothMax} > 0.01`);
    }
  }
  if (bad.length) {
    console.error('shore:check FAIL — ' + bad.join('; '));
    process.exit(1);
  }
  console.log('shore:check OK');
}
