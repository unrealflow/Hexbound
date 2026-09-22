/** look-sweep for P3 (grade): 3x3 saturation x split-tone grid + exposure
 *  probes, set as live uniforms (no rebuild), screenshots + manifest.
 *  Output: docs/shots/_sweep-p3-grade/<tag>.png + manifest.json
 *  Usage: node scripts/look-sweep-p3.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'shots', '_sweep-p3-grade');
mkdirSync(OUT, { recursive: true });

const SATS = [1.0, 1.22, 1.45];
const SPLITS = [0.2, 0.55, 0.9];
const EXPOSURE = 1.04;
const COMBOS = [];
for (const s of SATS) {
  for (const w of SPLITS) {
    COMBOS.push({
      tag: `G-sat${s.toFixed(2)}-spl${w.toFixed(2)}`,
      uExposure: EXPOSURE,
      uSaturation: s,
      uSplitWarm: w,
    });
  }
}
COMBOS.push({ tag: 'E-exp094', uExposure: 0.94, uSaturation: 1.22, uSplitWarm: 0.55 });
COMBOS.push({ tag: 'E-exp114', uExposure: 1.14, uSaturation: 1.22, uSplitWarm: 0.55 });

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
  { timeout: 240000, polling: 500 },
);
await page.waitForTimeout(1500);

const manifest = [];
for (const c of COMBOS) {
  await page.evaluate((v) => {
    const h = window.__hexbound;
    const mat = h.chunks.meshes[0].material;
    mat.setFloat('uExposure', v.uExposure);
    mat.setFloat('uSaturation', v.uSaturation);
    mat.setFloat('uSplitWarm', v.uSplitWarm);
  }, c);
  await page.waitForTimeout(650);
  const path = join(OUT, `${c.tag}.png`);
  await page.screenshot({ path, type: 'png' });
  manifest.push({ ...c, file: `${c.tag}.png` });
  console.log('saved', path);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
console.log('done');
