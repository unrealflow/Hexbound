/** Orthographic top-down / oblique captures for visual inspection.
 *
 *  Usage: node scripts/ortho-shot.mjs --tag t1 [--views spec]
 *  A view spec is `label:cx:cz:ortho[:oblique]`, comma separated; the default set
 *  is overview + forest + mountain + coast close-ups. Fog is switched off through
 *  the debug panel unless a view ends in `:fog`.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs', 'shots');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const PORT = Number(argOf('--port', 5173));
const TAG = argOf('--tag', 'ortho');
const DEFAULT = [
  'ov:0:0:18:oblique:fog',
  'forest:-8:10:5',
  'forest2:12:-8:5',
  'mtn:2:0:6',
  'mtn2:-4:-2:4',
  'coast:-16:-14:6',
  'coast2:-24:6:6',
];
const VIEWS = (argOf('--views', '') || DEFAULT.join(',')).split(',');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300));
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

await page.evaluate(() => {
  const h = window.__hexbound;
  window.__hb = {
    view(cx, cz, ortho, oblique, fog, notex, nodisp) {
      const V = h.camera.position.constructor;
      if (oblique) {
        h.camera.position.set(cx, 26, cz + 34);
        h.camera.setTarget(new V(cx, 0.5, cz));
      } else {
        h.camera.position.set(cx, 14, cz);
        h.camera.setTarget(new V(cx, 0, cz));
      }
      const a = h.engine.getAspectRatio(h.camera);
      h.camera.orthoTop = ortho;
      h.camera.orthoBottom = -ortho;
      h.camera.orthoLeft = -ortho * a;
      h.camera.orthoRight = ortho * a;
      const set = (id, on) => {
        const el = document.querySelector(id);
        if (el && el.checked !== on) {
          el.checked = on;
          el.dispatchEvent(new Event('change'));
        }
      };
      set('#dbg-fog', !!fog);
      set('#dbg-tex', !notex);
      set('#dbg-disp', !nodisp);
    },
  };
});

for (const spec of VIEWS) {
  const [label, cx, cz, ortho, ...flags] = spec.split(':');
  const oblique = flags.includes('oblique');
  const fog = flags.includes('fog');
  const notex = flags.includes('notex');
  const nodisp = flags.includes('nodisp');
  await page.evaluate(
    ([x, z, o, ob, fg, nt, nd]) => window.__hb.view(x, z, o, ob, fg, nt, nd),
    [Number(cx), Number(cz), Number(ortho), oblique, fog, notex, nodisp],
  );
  await page.evaluate(
    () =>
      new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120)));
      }),
  );
  const dataUrl = await page.evaluate(() => document.querySelector('#renderCanvas').toDataURL('image/png'));
  const path = join(OUT, `_${TAG}-${label}.png`);
  writeFileSync(path, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
  console.log('saved', path);
}

await browser.close();
