/** Edge-orientation metric: from straight above, histogram the direction of the
 *  strong luma gradients in the rendered frame, and A/B the detail texture.
 *  Hex-lattice structure puts its energy on vertical and +/-30 degree edges, an
 *  axis-aligned (world x/z) pattern on vertical and horizontal ones, and an
 *  isotropic field spreads evenly over the twelve bins. This is what separated
 *  the canopy's square crown lattice (60% of the energy on horizontal edges)
 *  from the hex lattice itself.
 *  Usage: node scripts/orient-metric.mjs [--cx X --cz Z --ortho S]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? Number(argv[i + 1]) : d;
};
const CX = argOf('--cx', 8);
const CZ = argOf('--cz', 12);
const ORTHO = argOf('--ortho', 8);

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
    window.__sq = {
      setTex(on) {
        const cb = document.querySelector('#dbg-tex');
        cb.checked = on;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      },
      /** Edge-orientation histogram of the luma field, and axis-aligned blockiness. */
      measure(minGrad) {
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
        for (let p = 0; p < W * H; p++) {
          lum[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2];
        }
        // 12 orientation bins over [0, 180) degrees.
        const NB = 12;
        const hist = new Float64Array(NB);
        let total = 0;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const p = y * W + x;
            const gx = (lum[p + 1] - lum[p - 1]) * 0.5;
            const gy = (lum[p + W] - lum[p - W]) * 0.5;
            const mag = Math.hypot(gx, gy);
            if (mag < minGrad) continue;
            // Gradient direction is perpendicular to the edge.
            let ang = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
            ang = ((ang % 180) + 180) % 180;
            hist[Math.min(NB - 1, Math.floor((ang / 180) * NB))] += mag;
            total += mag;
          }
        }
        // Bins are 15 degrees wide: 0 = horizontal edges, 6 = vertical, 2/10 = +/-30, 4/8 = +/-60.
        const share = (i) => (total > 0 ? hist[i] / total : 0);
        // Per-column and per-row mean |dLuma|: an axis-aligned block pattern makes
        // these spike at the block edges, so their spread rises above the diagonal
        // control (which no axis-aligned pattern can align with).
        const colMean = new Float64Array(W);
        const rowMean = new Float64Array(H);
        let diagSum = 0;
        let diagN = 0;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const p = y * W + x;
            colMean[x] += Math.abs(lum[p + 1] - lum[p - 1]);
            rowMean[y] += Math.abs(lum[p + W] - lum[p - W]);
          }
        }
        for (let x = 1; x < W - 1; x++) colMean[x] /= H - 2;
        for (let y = 1; y < H - 1; y++) rowMean[y] /= W - 2;
        for (let y = 1; y < H - 2; y++) {
          for (let x = 1; x < W - 2; x++) {
            const p = y * W + x;
            diagSum += Math.abs(lum[p + W + 1] - lum[p]);
            diagN++;
          }
        }
        const cv2 = (arr) => {
          let s = 0;
          for (const v of arr) s += v;
          const m = s / arr.length;
          let v2 = 0;
          for (const v of arr) v2 += (v - m) * (v - m);
          return Math.sqrt(v2 / arr.length) / Math.max(m, 1e-6);
        };
        return {
          histShare: Array.from(hist, (v) => +(total > 0 ? v / total : 0).toFixed(4)),
          horizontalEdges: +(share(0) + share(11)).toFixed(4),
          vertEdges: +share(6).toFixed(4),
          pm30: +(share(2) + share(10)).toFixed(4),
          pm60: +(share(4) + share(8)).toFixed(4),
          colDxCV: +cv2(colMean).toFixed(4),
          rowDyCV: +cv2(rowMean).toFixed(4),
          diagMean: +(diagSum / Math.max(diagN, 1)).toFixed(3),
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

await settle();
console.log('tex ON ', JSON.stringify(await page.evaluate(() => window.__sq.measure(6))));
await page.evaluate(() => window.__sq.setTex(false));
await settle();
console.log('tex OFF', JSON.stringify(await page.evaluate(() => window.__sq.measure(6))));
await page.evaluate(() => window.__sq.setTex(true));
await settle();
console.log('tex ON2', JSON.stringify(await page.evaluate(() => window.__sq.measure(6))));
await browser.close();
