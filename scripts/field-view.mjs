/** Field view: paint one packed terrain field as greyscale from straight above and
 *  report the orientation of its structure. Pairs with uDbgField in
 *  hexTerrain.frag.glsl (mode 0 = normal shading). Hex-lattice structure has
 *  vertical and +/-30 degree edges, axis-aligned (world x/z) structure has
 *  vertical and horizontal ones, so the histogram says which lattice a visible
 *  artifact comes from. Writes docs/shots/_field-<mode>-topdown.png per mode.
 *  Usage: node scripts/field-view.mjs [--cx X --cz Z --ortho S] [--modes 1,2,3]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'shots');
const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const CX = Number(argOf('--cx', 8));
const CZ = Number(argOf('--cz', 12));
const ORTHO = Number(argOf('--ortho', 8));
const MODES = String(argOf('--modes', '1,2,3,4,5,6,7,8,9,10'))
  .split(',')
  .map(Number);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5173/?t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
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
    h.camera.position.set(cx, 12, cz);
    h.camera.setTarget(new V(cx, 0, cz));
    const fog = document.querySelector('#dbg-fog');
    if (fog) {
      fog.checked = false;
      fog.dispatchEvent(new Event('change'));
    }
    const a = h.engine.getAspectRatio(h.camera);
    h.camera.orthoTop = size;
    h.camera.orthoBottom = -size;
    h.camera.orthoLeft = -size * a;
    h.camera.orthoRight = size * a;
    window.__fd = {
      set(mode) {
        h.chunks.material.setFloat('uDbgField', mode);
      },
      grab() {
        const c = document.querySelector('#renderCanvas');
        const cv = document.createElement('canvas');
        cv.width = c.width;
        cv.height = c.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(c, 0, 0);
        const W = cv.width;
        const H = cv.height;
        const d = ctx.getImageData(0, 0, W, H).data;
        const lum = new Float32Array(W * H);
        for (let p = 0; p < W * H; p++) lum[p] = d[p * 4];
        const NB = 12;
        const hist = new Float64Array(NB);
        let total = 0;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const p = y * W + x;
            const gx = (lum[p + 1] - lum[p - 1]) * 0.5;
            const gy = (lum[p + W] - lum[p - W]) * 0.5;
            const mag = Math.hypot(gx, gy);
            if (mag < 2) continue;
            let ang = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
            ang = ((ang % 180) + 180) % 180;
            hist[Math.min(NB - 1, Math.floor((ang / 180) * NB))] += mag;
            total += mag;
          }
        }
        const sh = (i) => +(total > 0 ? hist[i] / total : 0).toFixed(4);
        return {
          horizontal: +((sh(0) + sh(11)) * 1).toFixed(4),
          pm30: +(sh(2) + sh(10)).toFixed(4),
          pm60: +(sh(4) + sh(8)).toFixed(4),
          vertical: sh(6),
          hist: Array.from(hist, (v) => +(total > 0 ? v / total : 0).toFixed(3)),
          png: cv.toDataURL('image/png'),
        };
      },
    };
  },
  { cx: CX, cz: CZ, size: ORTHO },
);

const settle = () =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)))),
  );

const NAMES = {
  1: 'forestW(t1.g)',
  2: 'shoreW(t1.r)',
  3: 'reliefW(t1.a)',
  4: 'elevW(t0.b)',
  5: 'fidW(t0.g)',
  6: 'fbm(p*0.90)',
  7: 'waterW',
  8: 'mtnW',
  9: 'albedo',
  10: 'fbm(p*2.3)',
  11: 'canopyField',
  12: 'canopyHeight',
};

for (const m of MODES) {
  await page.evaluate((mm) => window.__fd.set(mm), m);
  await settle();
  const r = await page.evaluate(() => window.__fd.grab());
  writeFileSync(join(OUT, `_field-${m}-topdown.png`), Buffer.from(r.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
  delete r.png;
  console.log(String(m).padStart(2), NAMES[m].padEnd(14), JSON.stringify(r));
}
await page.evaluate(() => window.__fd.set(0));
await browser.close();
