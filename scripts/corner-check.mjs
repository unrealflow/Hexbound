/** Corner-consistency check on the *real* uploaded mesh data.
 *
 *  Every world position the mesher emits several vertices for (shared hex
 *  corners, and the side-wall vertices welded onto them) must agree on the
 *  inputs that drive the vertex-shader displacement:
 *    - effective displacement weights (elevation/mountain/forest, each scaled by
 *      the position-only dispW gate, since the shader derives them per vertex),
 *    - or, when the corner really is a cliff (its welded heights differ by at
 *      least CLIFF_DROP), the copies must be split into terraces that a side wall
 *      bridges.
 *  A mismatch here means the CPU-welded surface tears on the GPU and the sky can
 *  show through. Reads the vertex buffers the renderer uploaded, so it cannot
 *  drift from the mesher the way a re-implementation would.
 *  Usage: node scripts/corner-check.mjs [--port 5173]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 5173;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300));
});
await page.goto(`http://127.0.0.1:${PORT}/?t=` + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__hexbound && window.__hexbound.chunks.meshes.length > 0, null, {
  timeout: 180000,
  polling: 300,
});

const meshes = await page.evaluate(() => {
  const h = window.__hexbound;
  return h.chunks.meshes.map((m) => ({
    name: m.name,
    position: Array.from(m.getVerticesData('position')),
    normal: Array.from(m.getVerticesData('normal')),
    elev: Array.from(m.getVerticesData('elev')),
    mountainW: Array.from(m.getVerticesData('mountainW')),
    forestW: Array.from(m.getVerticesData('forestW')),
    dispW: Array.from(m.getVerticesData('dispW')),
  }));
});
// Read the threshold the mesher actually used. A hardcoded copy here classified
// correctly split corners as torn as soon as the source value changed.
const CLIFF_DROP = await page.evaluate(async () => {
  const tc = await import('/src/hex/terrainContinuity.ts');
  return tc.CLIFF_DROP;
});
await browser.close();

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** world position -> per-copy data */
const groups = new Map();
let vertices = 0;
let wallVertices = 0;
for (const mesh of meshes) {
  const n = mesh.position.length / 3;
  vertices += n;
  for (let v = 0; v < n; v++) {
    const x = mesh.position[v * 3];
    const y = mesh.position[v * 3 + 1];
    const z = mesh.position[v * 3 + 2];
    const ny = mesh.normal[v * 3 + 1];
    const damp = mesh.dispW[v];
    const copy = {
      y,
      elev: mesh.elev[v],
      mountainW: mesh.mountainW[v],
      forestW: mesh.forestW[v],
      dispW: damp,
      wall: Math.abs(ny) < 0.35,
      mesh: mesh.name,
      vert: v,
      w: [
        smoothstep(0.02, 0.09, mesh.elev[v]) * damp,
        smoothstep(0, 0.14, mesh.mountainW[v]) * damp,
        smoothstep(0, 0.16, mesh.forestW[v]) * damp,
      ],
    };
    if (copy.wall) wallVertices++;
    const key = `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`;
    let g = groups.get(key);
    if (!g) {
      g = { x: +x.toFixed(4), z: +z.toFixed(4), copies: [], wall: false };
      groups.set(key, g);
    }
    g.copies.push(copy);
    g.wall = g.wall || copy.wall;
  }
}

let sharedCorners = 0;
let crossChunkCorners = 0;
let tornWeights = 0;
let uncoveredCliffs = 0;
let maxYSpan = 0;
let worstWeightSpan = 0;
let maxCliffSpan = 0;
const examples = [];

for (const g of groups.values()) {
  if (g.copies.length < 2) continue;
  sharedCorners++;
  const names = new Set(g.copies.map((c) => c.mesh));
  if (names.size > 1) crossChunkCorners++;
  const ys = g.copies.map((c) => c.y);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  let wSpan = 0;
  for (let k = 0; k < 3; k++) {
    const vals = g.copies.map((c) => c.w[k]);
    wSpan = Math.max(wSpan, Math.max(...vals) - Math.min(...vals));
  }
  maxYSpan = Math.max(maxYSpan, ySpan);
  worstWeightSpan = Math.max(worstWeightSpan, wSpan);
  if (wSpan <= 1e-5) continue;
  if (ySpan >= CLIFF_DROP - 1e-6) {
    // Real cliff: the copies may split into terraces, but a wall has to bridge
    // them at this exact corner.
    if (!g.wall) uncoveredCliffs++;
    else maxCliffSpan = Math.max(maxCliffSpan, ySpan);
  } else {
    tornWeights++;
    if (examples.length < 6) {
      const fmt = (c) =>
        `[y=${c.y.toFixed(4)} e=${c.elev.toFixed(4)} m=${c.mountainW.toFixed(4)} f=${c.forestW.toFixed(4)} ` +
        `d=${c.dispW} w=${c.w.map((v) => v.toFixed(4)).join('/')} ${c.wall ? 'wall' : 'top'}]`;
      examples.push(`${g.x},${g.z} ySpan=${ySpan.toFixed(4)} wSpan=${wSpan.toFixed(4)}\n    ${g.copies.map(fmt).join('\n    ')}`);
    }
  }
}

const report = {
  meshes: meshes.length,
  vertices,
  wallVertices,
  sharedCorners,
  crossChunkCorners,
  tornWeightCorners: tornWeights,
  cliffsWithoutWall: uncoveredCliffs,
  worstWeightSpan: +worstWeightSpan.toExponential(2),
  maxCpuYSpanAtSharedCorner: +maxYSpan.toFixed(4),
  maxCliffSpanBridgedByWall: +maxCliffSpan.toFixed(4),
};
console.log(JSON.stringify(report, null, 1));
examples.forEach((e) => console.log('torn:', e));

if (tornWeights > 0 || uncoveredCliffs > 0) {
  console.error(`FAIL: ${tornWeights} torn corner(s), ${uncoveredCliffs} cliff(s) without a wall`);
  process.exit(1);
}
console.log('OK: every shared corner agrees on its displacement inputs, or is bridged by a wall');
