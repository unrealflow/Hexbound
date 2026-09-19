/** Sky-coverage check: does the terrain hide the sky everywhere inside the map?
 *
 *  Recolours the sky dome magenta and pushes the sun below the horizon at
 *  runtime (no source edits), then counts magenta pixels that are *not*
 *  reachable from the frame border by a flood fill. Border-reachable magenta is
 *  the sky around the map; magenta enclosed by terrain is a hole in the surface
 *  (what the user saw as a pale slit along the coast). Runs the check on the
 *  overview and on two picked coastal close-ups, writes an overlay PNG per setup
 *  (candidates stamped green, surviving holes red) and exits 1 if any enclosed
 *  sky survives.
 *
 *  A pixel only counts as a hole if it survives a 3x3 erosion, i.e. all eight of
 *  its neighbours are enclosed sky too. The anti-aliased band along a silhouette
 *  is one pixel wide, so every pixel in it has at least one terrain neighbour
 *  and none of it can survive; a gap in the surface has interior pixels. This
 *  check used to fail non-deterministically on single 1-px-wide strips (1 px and
 *  3 px long, on the ridge silhouette, in 2 of 6 identical runs) that were the
 *  rasteriser's coverage rounding, not geometry — the terrain does not move
 *  between runs, so a real slit cannot appear and vanish. The raw enclosed count
 *  is still reported, and the erosion cannot hide a real hole: the
 *  synthetic-hole control below hides one interior chunk and requires the eroded
 *  count to become non-zero.
 *
 *  Two controls guard the detector itself: the sky is first restored to its
 *  natural colours and the magenta test must match nothing, and the default
 *  overview must show more than 500 magenta pixels, or the detector has never
 *  been shown able to see sky at all.
 *  Usage: node scripts/hole-check.mjs [--port 5173]
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
await page.waitForFunction(
  () => {
    const h = window.__hexbound;
    return !!h && h.chunks.meshes.every((m) => m.isReady(true));
  },
  null,
  { timeout: 180000, polling: 500 },
);
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const w = window;
  // Values from src/scene/createScene.ts, so 'natural' restores exactly what the
  // app sets up rather than reading uniforms back through the effect API.
  const NATURAL = {
    uSkyZenith: [0.18, 0.38, 0.72],
    uSkyHorizon: [0.72, 0.78, 0.86],
    uSunDir: [0.62, 0.72, 0.3],
  };
  w.__hb = {
    /** 'natural' restores the real sky colours; 'magenta' recolours and pushes
     *  the sun below the horizon. The natural run is the detector's specificity
     *  control: the magenta test must match nothing on the shaded scene. */
    sky(mode) {
      const mesh = w.__hexbound.scene.meshes.find((m) => m.name === 'skyDome');
      if (!mesh) return false;
      const set = (name, v) => {
        // mesh.position is rewritten from the camera every frame, so it only
        // serves as scratch storage for the Vector3 class setVector3 wants.
        const z = mesh.position.clone();
        z.set(v[0], v[1], v[2]);
        mesh.material.setVector3(name, z);
      };
      if (mode === 'magenta') {
        // Both stops pure magenta and fully saturated: the horizon stop used to
        // be (1, 0, 0.5), which renders as (255, 2, 150) and fails the b > 150
        // test, so only anti-aliased sky/terrain blend rows were counted as sky
        // and every silhouette looked like a hole.
        set('uSkyZenith', [1, 0, 1]);
        set('uSkyHorizon', [1, 0, 1]);
        set('uSunDir', [0, -1, 0]);
      } else {
        for (const k of Object.keys(NATURAL)) set(k, NATURAL[k]);
      }
      return true;
    },
    pick(x, y) {
      const h = w.__hexbound;
      const r = h.scene.pick(x, y, null, false, h.camera);
      return r && r.hit ? { x: r.pickedPoint.x, y: r.pickedPoint.y, z: r.pickedPoint.z } : null;
    },
    panTo(wx, wz) {
      const h = w.__hexbound;
      const c = h.scene.pick(Math.round(innerWidth / 2), Math.round(innerHeight / 2), null, false, h.camera);
      if (!c || !c.hit) return null;
      h.camera.position.x += wx - c.pickedPoint.x;
      h.camera.position.z += wz - c.pickedPoint.z;
      return [+h.camera.position.x.toFixed(2), +h.camera.position.z.toFixed(2)];
    },
    setOrtho(size) {
      const h = w.__hexbound;
      const a = h.engine.getAspectRatio(h.camera);
      h.camera.orthoTop = size;
      h.camera.orthoBottom = -size;
      h.camera.orthoLeft = -size * a;
      h.camera.orthoRight = size * a;
    },
    /** Look straight down at a world point, so anything missing from the
     *  surface is surrounded by terrain inside the frame. */
    topDown(cx, cz) {
      const h = w.__hexbound;
      const p = h.camera.position.clone();
      // A hair off vertical: a straight-down look has no defined up vector.
      p.set(cx, 40, cz + 0.6);
      h.camera.position.copyFrom(p);
      const t = h.camera.position.clone();
      t.set(cx, 0, cz);
      h.camera.setTarget(t);
      return [+cx.toFixed(2), +cz.toFixed(2)];
    },
    /** Hide one interior chunk: the surface then really has a hole in it. */
    hideChunk(cx, cz, on) {
      const m = w.__hexbound.chunks.meshes.find(
        (mm) => mm.metadata && mm.metadata.cx === cx && mm.metadata.cz === cz,
      );
      if (!m) return false;
      m.setEnabled(!on);
      return true;
    },
    chunkBox(cx, cz) {
      const m = w.__hexbound.chunks.meshes.find(
        (mm) => mm.metadata && mm.metadata.cx === cx && mm.metadata.cz === cz,
      );
      if (!m) return null;
      const p = m.getVerticesData('position');
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] < x0) x0 = p[i];
        if (p[i] > x1) x1 = p[i];
        if (p[i + 2] < z0) z0 = p[i + 2];
        if (p[i + 2] > z1) z1 = p[i + 2];
      }
      return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
    },
    /** Coast finder: water at this pixel, land 60 px up-screen. */
    findCoast(x0, x1, y0, y1) {
      const p = (x, y) => w.__hb.pick(x, y);
      for (let y = y0; y < y1; y += 16) {
        for (let x = x1; x > x0; x -= 16) {
          const a = p(x, y);
          if (!a || a.y > 0.08) continue;
          const up = p(x, y - 60);
          if (up && up.y > 0.25) return { water: a, land: up };
        }
      }
      return null;
    },
    findPeak() {
      let best = null;
      for (let y = 120; y < 800; y += 24) {
        for (let x = 120; x < 1320; x += 24) {
          const a = w.__hb.pick(x, y);
          if (a && (!best || a.y > best.y)) best = a;
        }
      }
      return best;
    },
    measure() {
      const c = document.querySelector('#renderCanvas');
      const cv = document.createElement('canvas');
      cv.width = c.width;
      cv.height = c.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(c, 0, 0);
      const im = ctx.getImageData(0, 0, cv.width, cv.height);
      const d = im.data;
      const W = cv.width;
      const H = cv.height;
      const N = W * H;
      const sky = new Uint8Array(N);
      let mask = 0;
      for (let p = 0, i = 0; p < N; p++, i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (r > 150 && b > 150 && g + 80 < r && g + 80 < b) {
          sky[p] = 1;
          mask++;
        }
      }
      const seen = new Uint8Array(N);
      const stack = new Int32Array(N);
      let sp = 0;
      const push = (p) => {
        if (p < 0 || p >= N || seen[p] || !sky[p]) return;
        seen[p] = 1;
        stack[sp++] = p;
      };
      // 8-connected reachability. The dual pair for hole detection is
      // background 8-connected / foreground 4-connected: a 4-connected fill
      // leaks out through diagonal sky and reports every pinched-off sliver
      // along a silhouette as an enclosed hole.
      for (let x = 0; x < W; x++) {
        push(x);
        push(x + (H - 1) * W);
      }
      for (let y = 0; y < H; y++) {
        push(y * W);
        push(y * W + W - 1);
      }
      while (sp > 0) {
        const p = stack[--sp];
        const x = p % W;
        const y = (p - x) / W;
        push(p - 1);
        push(p + 1);
        push(p - W);
        push(p + W);
        push(p - W - 1);
        push(p - W + 1);
        push(p + W - 1);
        push(p + W + 1);
      }
      let interior = 0;
      let minX = 1e9;
      let maxX = -1;
      let minY = 1e9;
      let maxY = -1;
      for (let p = 0; p < N; p++) {
        if (sky[p] && !seen[p]) {
          interior++;
          const x = p % W;
          const y = (p - x) / W;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          d[p * 4] = 0;
          d[p * 4 + 1] = 255;
          d[p * 4 + 2] = 0;
        }
      }
      // Cluster the enclosed pixels: a few isolated pixels are anti-aliasing
      // residue on a silhouette, a large blob is a hole in the surface.
      const comp = new Int32Array(N);
      comp.fill(-1);
      const clusters = [];
      for (let p = 0; p < N; p++) {
        if (comp[p] >= 0 || !sky[p] || seen[p]) continue;
        const id = clusters.length;
        const st = [p];
        comp[p] = id;
        let size = 0;
        let sx = 0;
        let sy = 0;
        let cw = 0;
        let ch = 0;
        let x0 = 1e9;
        let x1 = -1;
        let y0 = 1e9;
        let y1 = -1;
        while (st.length) {
          const q = st.pop();
          const qx = q % W;
          const qy = (q - qx) / W;
          size++;
          sx += qx;
          sy += qy;
          if (qx < x0) x0 = qx;
          if (qx > x1) x1 = qx;
          if (qy < y0) y0 = qy;
          if (qy > y1) y1 = qy;
          cw = x1 - x0;
          ch = y1 - y0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx2 = qx + dx;
              const ny2 = qy + dy;
              if (nx2 < 0 || nx2 >= W || ny2 < 0 || ny2 >= H) continue;
              const r2 = ny2 * W + nx2;
              if (sky[r2] && !seen[r2] && comp[r2] < 0) {
                comp[r2] = id;
                st.push(r2);
              }
            }
          }
        }
        clusters.push({ size, cx: Math.round(sx / size), cy: Math.round(sy / size), w: cw, h: ch, x0, x1, y0, y1 });
      }
      clusters.sort((a, b) => b.size - a.size);
      // Erosion: only enclosed sky with all eight neighbours enclosed too counts
      // as a hole. See the header for why the silhouette band cannot survive it.
      const core = new Uint8Array(N);
      let coreCount = 0;
      for (let p = 0; p < N; p++) {
        if (!sky[p] || seen[p]) continue;
        const x = p % W;
        const y = (p - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
        let all = true;
        for (let dy = -1; dy <= 1 && all; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const r2 = p + dy * W + dx;
            if (!sky[r2] || seen[r2]) {
              all = false;
              break;
            }
          }
        }
        if (all) {
          core[p] = 1;
          coreCount++;
        }
      }
      const coreSeen = new Uint8Array(N);
      let coreClusters = 0;
      for (let p = 0; p < N; p++) {
        if (!core[p] || coreSeen[p]) continue;
        coreClusters++;
        coreSeen[p] = 1;
        const st2 = [p];
        while (st2.length) {
          const q = st2.pop();
          const qx = q % W;
          const qy = (q - qx) / W;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx2 = qx + dx;
              const ny2 = qy + dy;
              if (nx2 < 0 || nx2 >= W || ny2 < 0 || ny2 >= H) continue;
              const r2 = ny2 * W + nx2;
              if (core[r2] && !coreSeen[r2]) {
                coreSeen[r2] = 1;
                st2.push(r2);
              }
            }
          }
        }
      }
      // Red marks the pixels that actually fail the check; the green stamps
      // above are every enclosed candidate, including the eroded-away residue.
      for (let p = 0; p < N; p++) {
        if (!core[p]) continue;
        d[p * 4] = 255;
        d[p * 4 + 1] = 0;
        d[p * 4 + 2] = 0;
      }
      // ASCII neighbourhood of the largest clusters: 'o' an enclosed sky pixel,
      // '#' sky reachable from the border, '.' terrain. A hole shows up as 'o'
      // pixels with terrain above and below them. Clamped to a 61x25 window
      // around the centroid, or a chunk-sized hole would print the whole frame.
      const pad = 4;
      const halfW = 30;
      const halfH = 12;
      for (const c of clusters.slice(0, 3)) {
        const ax0 = Math.max(0, Math.max(c.x0 - pad, c.cx - halfW));
        const ax1 = Math.min(W - 1, Math.min(c.x1 + pad, c.cx + halfW));
        const ay0 = Math.max(0, Math.max(c.y0 - pad, c.cy - halfH));
        const ay1 = Math.min(H - 1, Math.min(c.y1 + pad, c.cy + halfH));
        const art = [];
        for (let y = ay0; y <= ay1; y++) {
          let row = '';
          for (let x = ax0; x <= ax1; x++) {
            const p = y * W + x;
            row += !sky[p] ? '.' : seen[p] ? '#' : 'o';
          }
          art.push(row);
        }
        c.art = art;
      }
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      out.getContext('2d').putImageData(im, 0, 0);
      return {
        W,
        H,
        skyPixels: mask,
        borderConnected: mask - interior,
        enclosedSkyPixels: interior,
        enclosedCorePixels: coreCount,
        coreClusters,
        clusters: clusters.slice(0, 8),
        largestCluster: clusters.length ? clusters[0].size : 0,
        bbox: interior ? [minX, minY, maxX, maxY] : null,
        overlay: out.toDataURL('image/png'),
      };
    },
  };
});

async function shot(label) {
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => window.__hb.measure());
  const buf = Buffer.from(m.overlay.replace(/^data:image\/png;base64,/, ''), 'base64');
  writeFileSync(join(OUT, `_hole-${label}.png`), buf);
  delete m.overlay;
  return m;
}

// Specificity control: with the sky at its normal colours the magenta test must
// match nothing, or every setup below is measuring the detector's own noise.
await page.evaluate(() => window.__hb.sky('natural'));
const control = await shot('control-natural-sky');
console.log('control (natural sky):', JSON.stringify(control));
if (control.skyPixels > 0) {
  console.error(`FAIL: ${control.skyPixels} pixel(s) pass the magenta test with the natural sky`);
  await browser.close();
  process.exit(1);
}

const setups = [];
const coast = await page.evaluate(() => window.__hb.findCoast(700, 1400, 420, 860));
if (coast) setups.push({ label: 'coast-ortho6', ortho: 6, at: coast.water });
const coast2 = await page.evaluate(() => window.__hb.findCoast(200, 1200, 300, 820));
if (coast2) setups.push({ label: 'coast-ortho2', ortho: 2, at: coast2.water });
const peak = await page.evaluate(() => window.__hb.findPeak());
if (peak) setups.push({ label: 'peak-ortho6', ortho: 6, at: peak });

await page.evaluate(() => window.__hb.sky('magenta'));
const results = [];

// Positive control: with the sky recoloured, the default view has to show some
// magenta. Every setup below is a close-up in which the terrain fills the frame,
// so without this control the whole check can pass while the detector is blind.
const posControl = await shot('positive-control-overview');
console.log('positive control (magenta sky, default camera):', JSON.stringify(posControl));
if (posControl.skyPixels < 500) {
  console.error(
    `FAIL: detector saw only ${posControl.skyPixels} magenta pixels with the sky recoloured and the map in a wide overview; the coverage check cannot be trusted`,
  );
  await browser.close();
  process.exit(1);
}
results.push({ label: 'positive-control-overview', ...posControl, positiveControl: true });

for (const s of setups) {
  const pan = await page.evaluate(([x, z]) => window.__hb.panTo(x, z), [s.at.x, s.at.z]);
  await page.evaluate((size) => window.__hb.setOrtho(size), s.ortho);
  const m = await shot(s.label);
  console.log(`${s.label}: pan=${JSON.stringify(pan)} ${JSON.stringify(m)}`);
  results.push({ label: s.label, ...m });
}

// Synthetic-hole control: hiding an interior chunk leaves a hole the width of a
// chunk in the surface, so the eroded criterion has to see it — otherwise the
// erosion that made this check deterministic has also made it blind. The same
// straight-down view with the chunk in place has to be clean, so the view itself
// is not what is being measured.
const HOLE_CHUNK = { cx: 2, cz: 2 };
const box = await page.evaluate(([cx, cz]) => window.__hb.chunkBox(cx, cz), [HOLE_CHUNK.cx, HOLE_CHUNK.cz]);
if (!box) {
  console.error(`FAIL: chunk ${HOLE_CHUNK.cx},${HOLE_CHUNK.cz} for the synthetic-hole control is missing`);
  await browser.close();
  process.exit(1);
}
const holeOrtho = Math.ceil(Math.max(box.d, box.w / 1.6) * 0.6);
await page.evaluate(([x, z]) => window.__hb.topDown(x, z), [box.x, box.z]);
await page.evaluate((s) => window.__hb.setOrtho(s), holeOrtho);
const holeBase = await shot('synthetic-hole-baseline');
console.log(`synthetic-hole-baseline (chunk ${HOLE_CHUNK.cx},${HOLE_CHUNK.cz} drawn, ortho ${holeOrtho}): ${JSON.stringify(holeBase)}`);
if (holeBase.enclosedCorePixels > 0) {
  console.error(`FAIL: the straight-down control view shows ${holeBase.enclosedCorePixels} hole pixel(s) with every chunk drawn`);
  await browser.close();
  process.exit(1);
}
await page.evaluate(([cx, cz]) => window.__hb.hideChunk(cx, cz, true), [HOLE_CHUNK.cx, HOLE_CHUNK.cz]);
const holeOpen = await shot('synthetic-hole-open');
console.log(`synthetic-hole-open (chunk ${HOLE_CHUNK.cx},${HOLE_CHUNK.cz} hidden): ${JSON.stringify(holeOpen)}`);
await page.evaluate(([cx, cz]) => window.__hb.hideChunk(cx, cz, false), [HOLE_CHUNK.cx, HOLE_CHUNK.cz]);
if (holeOpen.enclosedCorePixels < 50) {
  console.error(`FAIL: hiding a whole chunk left only ${holeOpen.enclosedCorePixels} hole pixel(s); the criterion cannot see a real hole`);
  await browser.close();
  process.exit(1);
}

const totalRaw = results.reduce((a, r) => a + r.enclosedSkyPixels, 0);
const totalCore = results.reduce((a, r) => a + r.enclosedCorePixels, 0);
console.log(
  JSON.stringify(
    {
      setups: results.map((r) => ({
        label: r.label,
        skyPixels: r.skyPixels,
        enclosedSkyPixels: r.enclosedSkyPixels,
        enclosedCorePixels: r.enclosedCorePixels,
      })),
      totalEnclosedSkyPixels: totalRaw,
      totalHolePixels: totalCore,
    },
    null,
    1,
  ),
);
await browser.close();

if (totalCore > 0) {
  console.error(`FAIL: ${totalCore} sky pixel(s) survive erosion inside the terrain: the surface has a hole`);
  process.exit(1);
}
console.log(`OK: no sky visible through the terrain in any setup (${totalRaw} raw candidate pixel(s), all silhouette residue)`);
