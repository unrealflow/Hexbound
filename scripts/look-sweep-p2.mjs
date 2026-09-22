/** look-sweep for P2 (lightmap): N uniform combos -> canvas shots + manifest.
 *  Uniforms live on the live material, so the sweep needs no rebuild — the
 *  lightmap bake itself is fixed data; this sweeps how the shader applies it.
 *  Output: docs/shots/_sweep-p2-light/<tag>.png + manifest.json
 *  Usage: node scripts/look-sweep-p2.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'shots', '_sweep-p2-light');
mkdirSync(OUT, { recursive: true });

const COMBOS = [
  { tag: 'L0-off', uShadowK: 0.0, uAOK: 0.0, uShadowCool: 0.0 },
  { tag: 'L1-soft', uShadowK: 0.6, uAOK: 0.5, uShadowCool: 0.25 },
  { tag: 'L2-mid', uShadowK: 0.85, uAOK: 0.75, uShadowCool: 0.5 },
  { tag: 'L3-hard', uShadowK: 0.95, uAOK: 0.75, uShadowCool: 0.5 },
  { tag: 'L4-mid-aoheavy', uShadowK: 0.85, uAOK: 1.0, uShadowCool: 0.5 },
  { tag: 'L5-hard-cool', uShadowK: 0.95, uAOK: 0.85, uShadowCool: 0.8 },
];

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
    mat.setFloat('uShadowK', v.uShadowK);
    mat.setFloat('uAOK', v.uAOK);
    mat.setFloat('uShadowCool', v.uShadowCool);
  }, c);
  await page.waitForTimeout(700);
  const path = join(OUT, `${c.tag}.png`);
  await page.screenshot({ path, type: 'png' });
  manifest.push({ ...c, file: `${c.tag}.png` });
  console.log('saved', path);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
console.log('done');
