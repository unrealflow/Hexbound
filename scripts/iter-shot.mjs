/** Fast iteration captures for shader tuning.
 * Usage: node scripts/iter-shot.mjs [tag] [--port 5173]   (dev server must be running)
 * Writes docs/shots/_<tag>-{1,2,3}-canvas.png (raw canvas: overview / zoomed relief / coastal pan).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'shots');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 5173;
const tag = argv.find((a) => !a.startsWith('--') && a !== String(PORT)) || 'iter';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('ERR', m.text().slice(0, 400));
});

await page.goto(`http://127.0.0.1:${PORT}/?t=` + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });

// Shader compilation can take tens of seconds on software GL — wait for the
// terrain material to actually be ready instead of a fixed delay.
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', renderer);
await page.waitForFunction(
  () => {
    const h = window.__hexbound;
    return !!h && h.chunks.meshes.every((m) => m.isReady(true));
  },
  null,
  { timeout: 180000, polling: 500 },
);
await page.waitForTimeout(1200);

async function shot(idx) {
  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('#renderCanvas');
    return c ? c.toDataURL('image/png') : null;
  });
  if (dataUrl && dataUrl.length > 1000) {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const path = join(OUT, `_${tag}-${idx}-canvas.png`);
    writeFileSync(path, Buffer.from(b64, 'base64'));
    console.log('saved', path);
  } else {
    console.log('dump failed', idx, dataUrl?.length ?? 0);
  }
}

await shot(1);

await page.mouse.wheel(0, -1400);
await page.waitForTimeout(900);
await shot(2);

await page.mouse.move(760, 420);
await page.mouse.down({ button: 'right' });
await page.mouse.move(520, 620, { steps: 14 });
await page.mouse.up({ button: 'right' });
await page.mouse.wheel(0, 900);
await page.waitForTimeout(900);
await shot(3);

await browser.close();
console.log('done');
