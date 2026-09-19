/** Terrain-following picking check.
 *
 *  The render mesh is only the displaced approximation of the continuous height
 *  field, so picking follows the field (heightAt / pickTerrain), not the mesh
 *  and not the y = 0 plane. Verified here against the uploaded mesh data and
 *  real camera rays:
 *    1. heightAt in 'none' mode (no displacement at all) reproduces the welded
 *       corner heights and fan centres the mesher uploaded, exactly — the field
 *       *is* the mesher's own fan. A cliff corner carries two terraces and the
 *       field is single-valued, so the field has to match one of them,
 *    2. picking a ray lands on the field: |hit.y − heightAt(hit.xz)| is ~0
 *       everywhere the field is continuous (it is stepped at cliff corners,
 *       where the surface really is two terraces),
 *    3. the field pick selects the same hex as the surface the GPU drew for
 *       almost every ray, while the old y = 0 plane method chose a different hex
 *       for a large share of rays,
 *    4. in 'shader' mode the field stands above the undisplaced mesh by the
 *       displacement amplitude, which is why the plane method had to go.
 *  Exits 1 on any inconsistency.
 *  Usage: node scripts/pick-check.mjs [--port 5173] [--rays 200]
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 5173;
const rayArg = argv.indexOf('--rays');
const RAYS = rayArg >= 0 ? Number(argv[rayArg + 1]) : 200;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300));
});
await page.goto(`http://127.0.0.1:${PORT}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(
  () => {
    const h = window.__hexbound;
    return !!h && h.chunks.meshes.every((m) => m.isReady(true));
  },
  null,
  { timeout: 180000, polling: 500 },
);
await page.waitForTimeout(800);

const report = await page.evaluate(async (RAYS) => {
  const h = window.__hexbound;
  const { scene, camera, map } = h;
  const { worldToAxialFrac, axialRound, axialToWorld } = await import('/src/hex/coords.ts');
  const { CLIFF_DROP } = await import('/src/hex/terrainContinuity.ts');

  // Vertex positions are float32 and a shared corner is emitted once per owning
  // cell, from three different chunk-local sums, so the copies can differ in the
  // last bit: (−1e−17).toFixed(3) is '-0.000' while (1e−17).toFixed(3) is
  // '0.000'. Keying on toFixed(3) therefore split one corner's copies into two
  // groups of one, and each group was then compared against a terrace it did not
  // own — reported as a 0.278 field error at a corner the field matched exactly.
  // Round to milli-units instead (String(−0) is '0'), and query the field at a
  // stored copy's exact position so the terrace choice is the same one the mesh
  // made.
  const vkey = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const meshGroups = new Map();
  for (const mesh of h.chunks.meshes) {
    const pos = mesh.getVerticesData('position');
    const nrm = mesh.getVerticesData('normal');
    for (let i = 0; i < pos.length; i += 3) {
      if (nrm[i + 1] < 0.9) continue; // side-wall vertices
      const k = vkey(pos[i], pos[i + 2]);
      let g = meshGroups.get(k);
      if (!g) {
        g = { x: pos[i], z: pos[i + 2], ys: [] };
        meshGroups.set(k, g);
      }
      g.ys.push(pos[i + 1]);
    }
  }
  const centreKeys = new Set();
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const c = map.getLocal(q, r);
      const w = axialToWorld(c.q, c.r);
      centreKeys.add(vkey(w.x, w.z));
    }
  }

  let cornerSamples = 0;
  let weldedCornerMaxErr = 0;
  let splitCornerMaxErr = 0;
  let splitCornerGroups = 0;
  let maxSplitSpan = 0;
  let splitBelowCliff = 0;
  let centreSamples = 0;
  let centreMaxErr = 0;
  let fieldAboveMeshMax = 0;
  const worst = [];
  for (const [k, g] of meshGroups) {
    const flat = h.terrainHeight(g.x, g.z, 'none');
    // The off-map sentinel is far below the terrain, so it fails the range test
    // in both directions rather than only the positive one.
    if (Math.abs(flat) > 500) continue;
    const isCentre = centreKeys.has(k);
    const span = Math.max(...g.ys) - Math.min(...g.ys);
    // Nearest terrace: the field is single-valued, so at a cliff corner it can
    // only ever land on one of the two the mesh drew.
    let err = Infinity;
    for (const y of g.ys) err = Math.min(err, Math.abs(flat - y));
    if (isCentre) {
      centreSamples++;
      centreMaxErr = Math.max(centreMaxErr, err);
    } else {
      cornerSamples++;
      if (span > 0.005) {
        // Two terraces: only the cliff branch of cornerTopY can produce them,
        // so the span has to reach CLIFF_DROP.
        splitCornerGroups++;
        maxSplitSpan = Math.max(maxSplitSpan, span);
        if (span < CLIFF_DROP - 1e-3) splitBelowCliff++;
        splitCornerMaxErr = Math.max(splitCornerMaxErr, err);
      } else {
        // One terrace shared by every owning cell: the field has no choice and
        // has to reproduce it exactly.
        weldedCornerMaxErr = Math.max(weldedCornerMaxErr, err);
      }
    }
    if (err > 1e-4) {
      worst.push({
        x: g.x,
        z: g.z,
        isCentre,
        meshY: g.ys.map((y) => +y.toFixed(4)),
        fieldY: +flat.toFixed(4),
        err: +err.toFixed(4),
      });
    }
    for (const y of g.ys) fieldAboveMeshMax = Math.max(fieldAboveMeshMax, h.terrainHeight(g.x, g.z, 'shader') - y);
  }
  worst.sort((a, b) => b.err - a.err);
  worst.length = Math.min(worst.length, 8);
  let offMapReadings = 0;
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const c = map.getLocal(q, r);
      const w = axialToWorld(c.q, c.r);
      if (Math.abs(h.terrainHeight(w.x, w.z, 'none')) > 500) offMapReadings++;
    }
  }

  // Camera rays.
  const w0 = scene.getEngine().getRenderWidth();
  const h0 = scene.getEngine().getRenderHeight();
  const errs = [];
  let vsGpuSamples = 0;
  let sameCellAsMeshPick = 0;
  let cellDiffers = 0;
  let cellSame = 0;
  let missField = 0;
  let missGpu = 0;
  let missGpuButFieldHit = 0;
  const cellOf = (x, z) => {
    const f = worldToAxialFrac(x, z);
    const a = axialRound(f.q, f.r);
    return `${a.q},${a.r}`;
  };
  for (let i = 0; i < RAYS; i++) {
    const px = 60 + ((i * 137) % (w0 - 120));
    const py = 60 + ((i * 271) % (h0 - 120));
    const ray = scene.createPickingRay(px, py, null, camera);
    const o = { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z };
    const d = { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z };
    const hit = h.pickTerrain(o, d, 'shader');
    const gpu = scene.pick(px, py, (m) => m.name !== 'skyDome');
    if (!hit) {
      missField++;
      continue;
    }
    if (!gpu || !gpu.hit) {
      missGpuButFieldHit++;
      continue;
    }
    errs.push(Math.abs(hit.y - h.terrainHeight(hit.x, hit.z, 'shader')));
    vsGpuSamples++;
    if (cellOf(gpu.pickedPoint.x, gpu.pickedPoint.z) === cellOf(hit.x, hit.z)) sameCellAsMeshPick++;
    const planeT = -o.y / d.y;
    if (Math.abs(d.y) > 1e-6 && planeT > 0) {
      if (cellOf(o.x + d.x * planeT, o.z + d.z * planeT) === cellOf(hit.x, hit.z)) cellSame++;
      else cellDiffers++;
    }
  }
  errs.sort((a, b) => a - b);
  const q = (p) => (errs.length ? +errs[Math.min(errs.length - 1, Math.floor(errs.length * p))].toExponential(2) : null);
  return {
    meshGroups: meshGroups.size,
    cornerSamples,
    weldedCornerMaxErr: +weldedCornerMaxErr.toExponential(2),
    splitCornerGroups,
    splitCornerMaxErr: +splitCornerMaxErr.toExponential(2),
    maxSplitSpan: +maxSplitSpan.toFixed(4),
    splitBelowCliff,
    centreSamples,
    centreMaxErr: +centreMaxErr.toExponential(2),
    cliffDrop: CLIFF_DROP,
    offMapReadings,
    worst,
    fieldAboveMeshMax: +fieldAboveMeshMax.toFixed(3),
    rays: RAYS,
    raysMissedByField: missField,
    raysHitByFieldButNotGpu: missGpuButFieldHit,
    onSurfaceErrMedian: q(0.5),
    onSurfaceErrP95: q(0.95),
    onSurfaceErrMax: q(1),
    vsGpuSamples,
    sameCellAsMeshPick,
    cellAgreesWithPlaneMethod: cellSame,
    cellDiffersFromPlaneMethod: cellDiffers,
  };
}, RAYS);

console.log(JSON.stringify(report, null, 1));
await browser.close();

const fails = [];
if (report.cornerSamples < 1000) fails.push(`only ${report.cornerSamples} corner samples`);
if (report.weldedCornerMaxErr > 2e-3)
  fails.push(`field misses a single-terrace corner height by ${report.weldedCornerMaxErr}`);
if (report.splitCornerMaxErr > 2e-3)
  fails.push(`field misses both terraces of a cliff corner by ${report.splitCornerMaxErr}`);
if (report.splitBelowCliff > 0)
  fails.push(`${report.splitBelowCliff} corner(s) carry two terraces below CLIFF_DROP`);
if (report.centreMaxErr > 2e-3) fails.push(`field misses the uploaded cell centres by ${report.centreMaxErr}`);
if (report.offMapReadings > 0) fails.push(`${report.offMapReadings} in-map cell centre(s) read as off-map`);
if (report.raysMissedByField > report.raysHitByFieldButNotGpu + 5)
  fails.push(`${report.raysMissedByField} rays missed the field entirely`);
if (report.onSurfaceErrP95 > 1e-3) fails.push(`p95 distance from a picked point to the field is ${report.onSurfaceErrP95}`);
if (report.vsGpuSamples < RAYS * 0.5) fails.push(`only ${report.vsGpuSamples} rays compared against the drawn surface`);
// scene.pick intersects the *pre-displacement* geometry, so near a hex border it
// can name a neighbour of the hex the user actually sees; 75% is the bar.
if (report.sameCellAsMeshPick < report.vsGpuSamples * 0.75)
  fails.push(`field pick chose the mesh-pick hex on only ${report.sameCellAsMeshPick}/${report.vsGpuSamples} rays`);
if (report.cellDiffersFromPlaneMethod < 5)
  fails.push(`the y=0 plane method agreed with the field on all but ${report.cellDiffersFromPlaneMethod} rays; the check does not exercise the fix`);
if (fails.length) {
  console.error(`FAIL:\n - ${fails.join('\n - ')}`);
  process.exit(1);
}
console.log('OK: the field is the mesher fan, picked rays land on it, and it matches the drawn surface');
