/** Displacement-weld check: is every vertex the mesher emits at one world
 *  position moved by the same amount once the vertex shader has run?
 *
 *  hexTerrain.vert.glsl moves a vertex by a function of (world xz, elev,
 *  mountainW, forestW, dispW) plus the canopy / wind terms, and the only reason
 *  the surface stays closed is that every copy of a shared vertex carries the
 *  same inputs. crack-metric checks that invariant on the *top fan* it models;
 *  this checks the real buffers, side walls included, which is where the bug it
 *  was written for lived: weldFromWorld used to return the owning cell's own
 *  scalar on a split corner, so two cells that snapped a corner to the same
 *  height came out with elev 0.2541 / forestW 0.6988 and 0.4273 / 0.4542 and the
 *  vertex shader tore the rim open — 535 px of sky visible through the terrain
 *  at ortho 6, all of it gone with displacement off.
 *
 *  A position is a failure when every copy there is displaced (dispW = 1) and
 *  the copies disagree on elev / mountainW / forestW or on the step(0.04, elev)
 *  branch the shader takes. Copies with dispW = 0 are flat by construction and
 *  are only reported.
 *
 *  Usage: node scripts/disp-weld-check.mjs [--port 5173]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 5173;
const EPS = 1e-6;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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

const out = await page.evaluate(() => {
  const h = window.__hexbound;
  const groups = new Map();
  for (const mesh of h.chunks.meshes) {
    const P = mesh.getVerticesData('position');
    const E = mesh.getVerticesData('elev');
    const M = mesh.getVerticesData('mountainW');
    const F = mesh.getVerticesData('forestW');
    const D = mesh.getVerticesData('dispW');
    const NR = mesh.getVerticesData('normal');
    const n = P.length / 3;
    for (let v = 0; v < n; v++) {
      const key = `${P[v * 3].toFixed(4)}|${P[v * 3 + 1].toFixed(4)}|${P[v * 3 + 2].toFixed(4)}`;
      let arr = groups.get(key);
      if (!arr) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push({
        mesh: mesh.name,
        y: +P[v * 3 + 1].toFixed(3),
        elev: +E[v].toFixed(5),
        mtn: +M[v].toFixed(5),
        forest: +F[v].toFixed(5),
        disp: +D[v].toFixed(5),
        ny: +NR[v * 3 + 1].toFixed(3),
      });
    }
  }
  const span = (arr, k) => Math.max(...arr.map((v) => v[k])) - Math.min(...arr.map((v) => v[k]));
  let multi = 0;
  let ampTear = 0;
  let landMaskTear = 0;
  let flatSpan = 0;
  const examples = [];
  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;
    multi++;
    const ampSpan = Math.max(span(arr, 'elev'), span(arr, 'mtn'), span(arr, 'forest'));
    const split = new Set(arr.map((v) => (v.elev >= 0.04 ? 1 : 0))).size > 1;
    const displaced = arr.every((v) => v.disp >= 0.5);
    if (!displaced) {
      flatSpan = Math.max(flatSpan, ampSpan);
      continue;
    }
    if (ampSpan > 1e-6) {
      ampTear++;
      if (examples.length < 5) examples.push(`amp ${key} span=${ampSpan.toFixed(4)} ${JSON.stringify(arr)}`);
    }
    if (split) {
      landMaskTear++;
      if (examples.length < 5) examples.push(`landMask ${key} ${JSON.stringify(arr)}`);
    }
  }
  return {
    meshes: h.chunks.meshes.length,
    positions: groups.size,
    multiCopyPositions: multi,
    displacedAmpTearPositions: ampTear,
    displacedLandMaskTearPositions: landMaskTear,
    /** Largest disagreement among copies that are not displaced (dispW = 0):
     *  harmless, every displacement term is scaled by dispW, but reported. */
    undisplacedAmpSpan: flatSpan,
    examples,
  };
});

console.log(JSON.stringify(out, null, 1));
await browser.close();
if (out.displacedAmpTearPositions > 0 || out.displacedLandMaskTearPositions > 0) {
  console.error(
    `FAIL: ${out.displacedAmpTearPositions} displaced position(s) disagree on a displacement input and ` +
      `${out.displacedLandMaskTearPositions} on the landMask branch: the vertex shader will tear them apart`,
  );
  process.exit(1);
}
console.log(
  `OK: every displaced world position moves as one vertex (${out.multiCopyPositions} shared positions checked)`,
);
