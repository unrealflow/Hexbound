/** Parameter sweep for look sprints (look-workflow §7).
 *  Requires: npm run dev on PORT (default 5173).
 *  Usage:
 *    node scripts/look-sweep.mjs --tag fog --var uEnableFog=0,1
 *    node scripts/look-sweep.mjs --tag fields --var uDbgField=0,4,8,9 --shot 1
 *  Writes docs/shots/_sweep-<tag>/<combo>-canvas.png and manifest.json.
 *  Cartesian product of --var flags; restores each uniform after the run.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const PORT = Number(argOf('--port', '5173'));
const TAG = String(argOf('--tag', 'sweep'));
const SHOT = Math.max(1, Math.min(3, Number(argOf('--shot', '1'))));
const vars = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--var' && argv[i + 1]) {
    const spec = argv[++i];
    const eq = spec.indexOf('=');
    if (eq < 1) continue;
    const name = spec.slice(0, eq).trim();
    const values = spec
      .slice(eq + 1)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (name && values.length) vars.push({ name, values });
  }
}
if (!vars.length) {
  console.error('usage: node scripts/look-sweep.mjs --tag NAME --var uniform=v1,v2[,v3...] [--shot 1|2|3] [--port 5173]');
  process.exit(2);
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((row) => list.map((v) => [...row, v])), [[]]);
}

const combos = cartesian(vars.map((v) => v.values));
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'shots', `_sweep-${TAG}`);
mkdirSync(outDir, { recursive: true });

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
await page.waitForFunction(
  () => {
    const h = window.__hexbound;
    return !!h && h.chunks.meshes.every((m) => m.isReady(true));
  },
  null,
  { timeout: 180000, polling: 500 },
);
await page.waitForTimeout(800);

if (SHOT >= 2) {
  await page.mouse.wheel(0, -1400);
  await page.waitForTimeout(700);
}
if (SHOT >= 3) {
  await page.mouse.move(760, 420);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(520, 620, { steps: 14 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(700);
}

const baseline = await page.evaluate((names) => {
  const mat = window.__hexbound.chunks.material;
  const out = {};
  for (const n of names) out[n] = mat.getFloat(n);
  return out;
}, vars.map((v) => v.name));

const entries = [];
for (const combo of combos) {
  const sets = vars.map((v, i) => ({ name: v.name, value: combo[i] }));
  const stem = sets.map((s) => `${s.name}${s.value}`).join('_');
  await page.evaluate((pairs) => {
    const mat = window.__hexbound.chunks.material;
    for (const p of pairs) mat.setFloat(p.name, p.value);
  }, sets);
  await page.waitForTimeout(120);
  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('#renderCanvas');
    return c ? c.toDataURL('image/png') : null;
  });
  const file = `${stem}-canvas.png`;
  if (dataUrl && dataUrl.length > 1000) {
    writeFileSync(join(outDir, file), Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('saved', file);
  } else {
    console.log('dump failed', stem, dataUrl?.length ?? 0);
  }
  entries.push({ file, uniforms: Object.fromEntries(sets.map((s) => [s.name, s.value])) });
}

await page.evaluate((base) => {
  const mat = window.__hexbound.chunks.material;
  for (const [n, v] of Object.entries(base)) {
    if (typeof v === 'number' && Number.isFinite(v)) mat.setFloat(n, v);
  }
}, baseline);

const manifest = {
  tag: TAG,
  shot: SHOT,
  port: PORT,
  baseline,
  count: entries.length,
  entries,
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
console.log('done', outDir, 'n=', entries.length);
