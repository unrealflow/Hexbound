/** Capture Hexbound canvas screenshots.
 * Requires: npm i -D playwright && npx playwright install chrome (or system Google Chrome).
 * Dev server: npm run dev  (vite default port 5173)
 * Usage: npm run shots [-- --port 5173]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'shots');
mkdirSync(OUT, { recursive: true });

const portArg = process.argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(process.argv[portArg + 1]) : 5173;
const BASE = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-gl=angle',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('ERR', m.text());
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#renderCanvas', { timeout: 30000 });
await page.waitForFunction(() => {
  const t = document.body?.innerText || '';
  return t.includes('Hexbound') && t.includes('Seed');
}, null, { timeout: 20000 });
// Terrain shader can take tens of seconds to compile — wait for mesh readiness.
await page.waitForFunction(
  () => {
    const h = window.__hexbound;
    return !!h && h.chunks.meshes.every((m) => m.isReady(true));
  },
  null,
  { timeout: 180000, polling: 500 },
);
await page.waitForTimeout(1500);

async function shot(name) {
  const path = join(OUT, name);
  await page.screenshot({ path, type: 'png' });
  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('#renderCanvas');
    return c ? c.toDataURL('image/png') : null;
  });
  if (dataUrl && dataUrl.length > 1000) {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    writeFileSync(path.replace('.png', '-canvas.png'), Buffer.from(b64, 'base64'));
  }
  console.log('saved', path, 'dataUrlLen', dataUrl?.length ?? 0);
}

await shot('01-overview-default.png');

await page.mouse.wheel(0, -1000);
await page.waitForTimeout(1000);
await shot('02-zoomed-cliffs.png');

await page.mouse.move(720, 460);
await page.mouse.down({ button: 'right' });
await page.mouse.move(360, 600, { steps: 16 });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(800);
await shot('03-panned-coast.png');

await page.mouse.wheel(0, 1600);
await page.waitForTimeout(1000);
await shot('04-wide-biomes.png');

const randBtn = page.locator('#dbg-rand');
if (await randBtn.count()) {
  await randBtn.click();
  await page.waitForTimeout(3000);
  await shot('05-reseed-diversity.png');
}

await browser.close();
console.log('done');
