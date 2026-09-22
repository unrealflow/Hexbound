/** look-channels — capture shape-evidence channels at the OFFICIAL cameras
 *  (look-workflow §4/§7). Sets uDbgField on the live material and screenshots:
 *   9 = albedo luma (grey — the P1/P2 golden evidence), 13 = albedo colour,
 *   4 = blended elevation. Output: docs/shots/_look-<tag>-<mode>.png
 *  Usage: node scripts/look-channels.mjs [--tag p1] [--modes 9,13] [--ortho S]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'shots');
const argv = process.argv;
const argOf = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d);
const TAG = argOf('--tag', 'p1');
const MODES = argOf('--modes', '9,13,4').split(',').map(Number);
const ORTHO = Number(argOf('--ortho', '0')); // 0 = leave the default camera

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
await page.waitForTimeout(1500);

if (ORTHO > 0) {
  await page.evaluate((o) => {
    const h = window.__hexbound;
    const V = h.camera.position.constructor;
    const cx = 8, cz = 12;
    h.camera.position.set(cx, 12, cz);
    h.camera.setTarget(new V(cx, 0, cz));
    const a = h.engine.getAspectRatio(h.camera);
    h.camera.orthoTop = o;
    h.camera.orthoBottom = -o;
    h.camera.orthoLeft = -o * a;
    h.camera.orthoRight = o * a;
  }, ORTHO);
  await page.waitForTimeout(300);
}

for (const mode of MODES) {
  await page.evaluate((m) => {
    const h = window.__hexbound;
    const mat = h.chunks.meshes[0].material;
    mat.setFloat('uDbgField', m);
    const fog = document.querySelector('#dbg-fog');
    if (fog && m >= 9) {
      fog.checked = false;
      fog.dispatchEvent(new Event('change'));
    }
  }, mode);
  await page.waitForTimeout(900);
  const path = join(OUT, `_look-${TAG}-mode${mode}.png`);
  await page.screenshot({ path, type: 'png' });
  console.log('saved', path);
}

// Always leave one normal capture for the same tag (lighting on, uDbgField 0).
await page.evaluate(() => {
  const h = window.__hexbound;
  h.chunks.meshes[0].material.setFloat('uDbgField', 0);
});
await page.waitForTimeout(600);
const lit = join(OUT, `_look-${TAG}-lit.png`);
await page.screenshot({ path: lit, type: 'png' });
console.log('saved', lit);
await browser.close();
