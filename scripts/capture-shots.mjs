/** Capture Hexbound canvas screenshots.
 * Requires: npm i -D playwright && npx playwright install chrome (or system Google Chrome).
 * Dev server: npm run dev -- --host 127.0.0.1 --port 5188
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUT = '/workspace/Hexbound/docs/shots';
mkdirSync(OUT, { recursive: true });

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

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('#renderCanvas', { timeout: 30000 });
await page.waitForFunction(() => {
  const t = document.body?.innerText || '';
  return t.includes('Hexbound') && t.includes('Seed');
}, null, { timeout: 20000 });
await page.waitForTimeout(4500);

async function shot(name) {
  const path = join(OUT, name);
  // Full page for UI context
  await page.screenshot({ path, type: 'png' });
  // Also dump canvas pixels via toDataURL for reliability
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
