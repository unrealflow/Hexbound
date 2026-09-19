import { AXIAL_DIRS, HEX_SIZE, axialRound, axialToWorld, hexCornerOffset, worldToAxialFrac } from './coords';
import { HexMap, Terrain } from './HexMap';

/**
 * World units per unit of cell elevation. The seeded map spans elev 0.16..0.84,
 * so 2.0 put the whole map's relief at 1.2 world units — 0.7 of a hex width,
 * which reads as a flat plate next to the reference art. 4.0 keeps the same
 * landform pattern at 2.4 units of relief and lifts the summit ~3 units over
 * the sea (about 1.7 hex widths), which is the silhouette the references show.
 * The shader's own displacement amplitude is a separate uniform (uElevScale,
 * mirrored by U_ELEV), so raising this stretches the terrain without making the
 * micro-relief bumpier.
 */
export const ELEV_SCALE = 4.0;

export function isWaterTerrain(t: number): boolean {
  return t === Terrain.ShallowWater || t === Terrain.DeepWater;
}

export function isWaterLocal(map: HexMap, lq: number, lr: number): boolean {
  if (!map.inBoundsLocal(lq, lr)) return true;
  return isWaterTerrain(map.getLocal(lq, lr).terrainId);
}

/**
 * Welded land height. The raw per-cell elevation is smoothed with its land
 * neighbours so the top surface is a continuous field: a cell is not a plate
 * standing at its own height, which is what read as a per-hex facet.
 * Water stays coplanar at WATER_Y.
 *
 * The smoothing is deliberately unconditional. An earlier version blended back
 * toward the raw height when the local relief was large, to preserve
 * escarpments for the cliff walls the mesher used to emit; the terrain spec has
 * since changed — every planar cross-section of the terrain must be a
 * continuous, smooth curve, so vertical walls and terrace steps are gone and
 * steep ground is expressed only as a steep (but continuous) slope.
 */
export const WATER_Y = 0.02;

/**
 * Historical thresholds of the removed cliff-wall mechanism, kept only because
 * the gate scripts still read them (corner-check / pick-check use CLIFF_DROP to
 * classify corner spans, which are now always ~0). The mesher no longer emits
 * walls, so no height discontinuity can be bridged by geometry.
 */
export const CLIFF_DROP = 0.60;
export const RAMP_DROP = 0.28;

/**
 * Legacy companion of CLIFF_DROP (smallest step that used to get a side wall).
 * Unused by the mesher since the wall mechanism was removed.
 */
export const MIN_WALL_DROP = 0.005;

/** Off-map height for picking: far below anything, so no ray ever hits it. */
const OUT_OF_MAP_Y = -1e3;

export function cellTopY(map: HexMap, lq: number, lr: number): number {
  if (!map.inBoundsLocal(lq, lr)) return WATER_Y;
  const cell = map.getLocal(lq, lr);
  if (isWaterTerrain(cell.terrainId)) return WATER_Y;
  let sum = cell.elev;
  let n = 1;
  for (const d of AXIAL_DIRS) {
    const nq = lq + d.q;
    const nr = lr + d.r;
    if (!map.inBoundsLocal(nq, nr)) continue;
    const nc = map.getLocal(nq, nr);
    if (isWaterTerrain(nc.terrainId)) continue;
    sum += nc.elev;
    n++;
  }
  // Unconditional smoothing: every planar cross-section of the terrain has to
  // be a continuous curve, so there is no "keep the raw height at escarpments"
  // term any more — steep ground is a steep slope, never a step.
  return (sum / n) * ELEV_SCALE;
}

/**
 * Which of the three surfaces a height query means.
 *  'shader'  — what the vertex shader draws (the default, and what the user sees)
 *  'preview' — what the uEnableDisplace = 0 toggle draws
 *  'none'    — the undisplaced fan the mesher uploaded; scripts/pick-check.mjs
 *              uses it to prove the field *is* that fan and not an approximation
 */
export type DispMode = 'shader' | 'preview' | 'none';

/**
 * Welded top-surface height at a world position, for terrain-following picking.
 * The mesher builds every top face as a triangle fan from the cell centre (the
 * mean of its six welded corner heights) to its welded, displaced corners, so
 * evaluating that same fan here reproduces the rendered surface rather than
 * approximating it. Picking off the y = 0 plane instead reads the hex under a
 * point that can be a cell away from the one under the cursor on any slope.
 * The canopy lift is not replicated (it adds at most 0.09 world units and is
 * animated).
 */
export function heightAt(map: HexMap, x: number, z: number, mode: DispMode = 'shader'): number {
  const f = worldToAxialFrac(x, z);
  const c = axialRound(f.q, f.r);
  // A point on the map border rounds to whichever cell owns it, which can be
  // just outside. Fall back to the nearest in-map cell among the six
  // neighbours, or the outermost rim would read as off-map.
  const lq0 = c.q - map.originQ;
  const lr0 = c.r - map.originR;
  let lq = lq0;
  let lr = lr0;
  if (!map.inBoundsLocal(lq, lr)) {
    let best = Infinity;
    lq = -1;
    const lim = HEX_SIZE * 1.05;
    for (const d of [{ q: 0, r: 0 }, ...AXIAL_DIRS]) {
      const tq = lq0 + d.q;
      const tr = lr0 + d.r;
      if (!map.inBoundsLocal(tq, tr)) continue;
      const p = axialToWorld(tq + map.originQ, tr + map.originR, HEX_SIZE);
      const dx = p.x - x;
      const dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      // Only the hairline just outside the rim belongs to the map; anything
      // further out must stay off-map, or a ray at the sky would find ground.
      if (d2 > lim * lim) continue;
      if (d2 < best) {
        best = d2;
        lq = tq;
        lr = tr;
      }
    }
    if (lq < 0) return OUT_OF_MAP_Y;
  }
  const cell = map.getLocal(lq, lr);
  const { x: cx, z: cz } = axialToWorld(cell.q, cell.r, HEX_SIZE);
  if (isWaterTerrain(cell.terrainId)) return WATER_Y;

  const yTopFlat = cell.elev * ELEV_SCALE;
  const ys: number[] = [];
  for (let i = 0; i < 6; i++) {
    const o = hexCornerOffset(i, HEX_SIZE);
    const wx = cx + o.x;
    const wz = cz + o.z;
    ys.push(
      cornerTopY(map, lq, lr, i, yTopFlat, false) +
        (mode === 'none'
          ? 0
          : displaceLandY(
              wx,
              wz,
              weldCornerScalar(map, lq, lr, i, rawElev),
              weldCornerScalar(map, lq, lr, i, rawMountainW),
              dispWeight(map, wx, wz),
              mode === 'shader',
            )),
    );
  }
  let yCenter = yTopFlat;
  for (let i = 0; i < 6; i++) yCenter += ys[i]!;
  yCenter /= 7;

  const ox = x - cx;
  const oz = z - cz;
  let a = Math.atan2(oz, ox);
  const sector = Math.floor(((a + Math.PI / 6 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 3)) % 6;
  const A = hexCornerOffset(sector, HEX_SIZE);
  const B = hexCornerOffset((sector + 1) % 6, HEX_SIZE);
  const det = A.x * B.z - B.x * A.z;
  let u = (ox * B.z - B.x * oz) / det;
  let v = (A.x * oz - ox * A.z) / det;
  const s = u + v;
  if (s > 1) {
    u /= s;
    v /= s;
  }
  const ya = ys[sector]!;
  const yb = ys[(sector + 1) % 6]!;
  return yCenter + u * (ya - yCenter) + v * (yb - yCenter);
}

export interface TerrainHit {
  x: number;
  y: number;
  z: number;
}

/**
 * March a picking ray against the height field. The surface is single-valued in
 * xz, so a sign change of (rayY − heightAt) brackets one crossing; the coarse
 * march finds the bracket and a bisection refines it. This deliberately does not
 * use scene.pick: the render mesh is only the displaced *approximation* of the
 * field, and picking must stay valid when the mesh changes.
 */
export function pickTerrain(
  map: HexMap,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist = 120,
  mode: DispMode = 'shader',
): TerrainHit | null {
  if (Math.abs(dir.y) < 1e-6) return null;
  const step = 0.25;
  let prevT = 0;
  let prevD = origin.y - heightAt(map, origin.x, origin.z, mode);
  for (let t = step; t <= maxDist; t += step) {
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    const d = origin.y + dir.y * t - heightAt(map, x, z, mode);
    if (d <= 0 && prevD > 0) {
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) * 0.5;
        const mx = origin.x + dir.x * mid;
        const mz = origin.z + dir.z * mid;
        if (origin.y + dir.y * mid - heightAt(map, mx, mz, mode) > 0) lo = mid;
        else hi = mid;
      }
      const t2 = (lo + hi) * 0.5;
      return { x: origin.x + dir.x * t2, y: origin.y + dir.y * t2, z: origin.z + dir.z * t2 };
    }
    prevT = t;
    prevD = d;
  }
  return null;
}

export function rawElev(map: HexMap, lq: number, lr: number): number {
  if (!map.inBoundsLocal(lq, lr) || isWaterLocal(map, lq, lr)) return 0;
  return map.getLocal(lq, lr).elev;
}

export function rawMountainW(map: HexMap, lq: number, lr: number): number {
  if (!map.inBoundsLocal(lq, lr) || isWaterLocal(map, lq, lr)) return 0;
  const e = map.getLocal(lq, lr).elev;
  // Engage ridge displace earlier so spines read before the absolute peak.
  const t = Math.min(1, Math.max(0, (e - 0.28) / 0.30));
  return t * t * (3 - 2 * t);
}

export function rawForestW(map: HexMap, lq: number, lr: number): number {
  if (!map.inBoundsLocal(lq, lr) || isWaterLocal(map, lq, lr)) return 0;
  return map.getLocal(lq, lr).forestCover;
}

/** Cell sharing edge i, found geometrically (edge i spans corners i and i+1). */
export function edgeNeighbour(
  map: HexMap,
  lq: number,
  lr: number,
  edge: number,
): [number, number] | null {
  const cell = map.getLocal(lq, lr);
  const { x: cx, z: cz } = axialToWorld(cell.q, cell.r, HEX_SIZE);
  const a = hexCornerOffset(edge, HEX_SIZE);
  const b = hexCornerOffset((edge + 1) % 6, HEX_SIZE);
  const mx = cx + (a.x + b.x) * 0.5;
  const mz = cz + (a.z + b.z) * 0.5;
  let dx = mx - cx;
  let dz = mz - cz;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const px = mx + dx * 0.06;
  const pz = mz + dz * 0.06;
  const f = worldToAxialFrac(px, pz);
  const r0 = axialRound(f.q, f.r);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const h of [{ q: r0.q, r: r0.r }, ...AXIAL_DIRS.map((d) => ({ q: r0.q + d.q, r: r0.r + d.r }))]) {
    const q = h.q - map.originQ;
    const r = h.r - map.originR;
    if (!map.inBoundsLocal(q, r)) continue;
    if (q === lq && r === lr) continue;
    const w = axialToWorld(h.q, h.r, HEX_SIZE);
    const d = Math.hypot(px - w.x, pz - w.z);
    if (d < bestD) {
      bestD = d;
      best = [q, r];
    }
  }
  return best;
}

export function vertexSpanY(map: HexMap, x: number, z: number): number {
  const hexes = hexesAtWorldVertex(map, x, z);
  if (hexes.length === 0) return 0;
  const ys = hexes.map(([q, r]) => cellTopY(map, q, r));
  return Math.max(...ys) - Math.min(...ys);
}

function hexesAtWorldVertex(map: HexMap, x: number, z: number): [number, number][] {
  const f = worldToAxialFrac(x, z);
  const c = axialRound(f.q, f.r);
  const cands = [{ q: c.q, r: c.r }, ...AXIAL_DIRS.map((d) => ({ q: c.q + d.q, r: c.r + d.r }))];
  const out: [number, number][] = [];
  for (const h of cands) {
    const lq = h.q - map.originQ;
    const lr = h.r - map.originR;
    if (!map.inBoundsLocal(lq, lr)) continue;
    const w = axialToWorld(h.q, h.r, HEX_SIZE);
    const d = Math.hypot(x - w.x, z - w.z);
    if (Math.abs(d - HEX_SIZE) < 0.12) out.push([lq, lr]);
  }
  return out;
}

/**
 * Displacement gate for the vertex shader. It is a function of the world
 * position only, never of the cell that owns the vertex, and it is 0 as soon as
 * one of the cells meeting there is water: the land copy and the water copy of
 * a coastal corner then get the same (zero) displacement instead of rising and
 * staying put, which is what tore the CPU-welded corner apart on the GPU and
 * left a sky-coloured slit along the coast.
 */
export function dispWeight(map: HexMap, x: number, z: number): number {
  const hexes = hexesAtWorldVertex(map, x, z);
  if (hexes.length === 0) return 0;
  for (const [q, r] of hexes) {
    if (isWaterLocal(map, q, r)) return 0;
  }
  return 1;
}

export function weldFromWorld(
  map: HexMap,
  x: number,
  z: number,
  getter: (map: HexMap, q: number, r: number) => number,
  selfLq: number,
  selfLr: number,
): number {
  const hexes = hexesAtWorldVertex(map, x, z);
  if (hexes.length === 0) return getter(map, selfLq, selfLr);
  // Unconditional weld. The split-corner branch is gone with the cliff-wall
  // mechanism: every copy of a world corner must carry the same scalar, which
  // is what keeps the surface single-valued and the displaced mesh watertight.
  const vals = hexes.map(([q, r]) => getter(map, q, r));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Same hexes that actually share this geometric corner. */
export function weldCornerScalar(
  map: HexMap,
  lq: number,
  lr: number,
  corner: number,
  getter: (map: HexMap, q: number, r: number) => number,
): number {
  const cell = map.getLocal(lq, lr);
  const { x: cx, z: cz } = axialToWorld(cell.q, cell.r, HEX_SIZE);
  const o = hexCornerOffset(corner, HEX_SIZE);
  return weldFromWorld(map, cx + o.x, cz + o.z, getter, lq, lr);
}

/**
 * The neighbour's own corner index for the vertex at world (x, z). A side wall
 * welding its bottom edge has to land on the *same* vertices the neighbour's top
 * face uses: handing the neighbour this cell's edge index picks a different one
 * of its vertices, so the wall bottom carried the attributes of the wrong rim.
 */
export function sharedCornerIndex(
  map: HexMap,
  lq: number,
  lr: number,
  x: number,
  z: number,
): number {
  const cell = map.getLocal(lq, lr);
  const c = axialToWorld(cell.q, cell.r, HEX_SIZE);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 6; i++) {
    const o = hexCornerOffset(i, HEX_SIZE);
    const d = Math.hypot(x - (c.x + o.x), z - (c.z + o.z));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function avg7(
  map: HexMap,
  lq: number,
  lr: number,
  getter: (map: HexMap, q: number, r: number) => number,
): number {
  let sum = getter(map, lq, lr);
  let n = 1;
  for (const d of AXIAL_DIRS) {
    const nq = lq + d.q;
    const nr = lr + d.r;
    if (!map.inBoundsLocal(nq, nr)) continue;
    sum += getter(map, nq, nr);
    n++;
  }
  return sum / n;
}

export function cornerTopY(
  map: HexMap,
  lq: number,
  lr: number,
  corner: number,
  selfY: number,
  isWater: boolean,
): number {
  if (isWater) return 0.02;
  // Corner k is the meeting point of edges k-1 and k, so its three cells are
  // self plus the two neighbours across those edges: AXIAL_DIRS[(k+1)%6] and
  // AXIAL_DIRS[(k+2)%6] (edge i faces AXIAL_DIRS[(i+2)%6], verified in
  // scripts/_diag-edge.ts). OOB shares behave as water.
  const cell = map.getLocal(lq, lr);
  const { x: cx, z: cz } = axialToWorld(cell.q, cell.r, HEX_SIZE);
  const o = hexCornerOffset(corner, HEX_SIZE);
  const hexes = hexesAtWorldVertex(map, cx + o.x, cz + o.z);
  if (hexes.length === 0) return selfY;
  const ys = hexes.map(([q, r]) => cellTopY(map, q, r));

  // Coastal apron: a corner shared with water sits on the sea surface, so the
  // shore reads as a continuous beach slope instead of a floating hex block.
  let waterNbrs = 3 - hexes.length;
  for (const [q, r] of hexes) {
    if (cellTopY(map, q, r) <= 0.02 + 1e-6) waterNbrs++;
  }
  if (waterNbrs > 0) return 0.02;

  // Unconditional weld to the three cells' mean. There is no split/snap branch
  // any more: the terrain spec requires every cross-section to be continuous,
  // so a world corner has exactly one height and the mesh needs no walls.
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

function hash21(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash21(ix, iz);
  const b = hash21(ix + 1, iz);
  const c = hash21(ix, iz + 1);
  const d = hash21(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2(x: number, z: number): number {
  return vnoise(x, z) * 0.65 + vnoise(x * 2.03 + 17.1, z * 2.03) * 0.35;
}

function ridgeFbm(x: number, z: number): number {
  const n = fbm2(x, z);
  const r = 1 - Math.abs(2 * n - 1);
  return r * r;
}

const U_ELEV = 2.0;

/**
 * CPU replica of the land displacement in hexTerrain.vert.glsl, used by the
 * continuity metrics and by terrain-following picking. It matches the shader
 * term for term: the weights carry the position-symmetric `dispW` gate, and no
 * term is gated on the face kind, because a side-wall vertex must move exactly
 * like the terrace rim it is welded to. The canopy lift (forestW * pos.xz
 * noise) is not replicated here: it is not part of this height field.
 */
export function displaceLandY(
  x: number,
  z: number,
  elev: number,
  mountainW: number,
  dispW: number,
  enableDisplace = true,
): number {
  const landW = smoothstep(0.02, 0.09, elev) * dispW;
  const mtnW = smoothstep(0, 0.14, mountainW) * dispW;
  const md = fbm2(x * 1.1, z * 1.1);
  const landAmp = 0.55 - 0.15 * mountainW;
  const cliffBoost = smoothstep(0.35, 0.85, elev) * 0.32;
  let dy = 0;
  if (enableDisplace) {
    dy += ((md - 0.45) * 0.12 * landAmp + cliffBoost * elev) * U_ELEV * 0.7 * landW;
    // Mirrored from hexTerrain.vert.glsl anisotropic ridges.
    const rx = 0.866 * x - 0.5 * z;
    const rz = 0.5 * x + 0.866 * z;
    const rd = ridgeFbm(rx * 0.22, rz * 0.78);
    dy += (rd - 0.28) * 0.78 * mtnW * U_ELEV;
    const rd2 = ridgeFbm(rx * 0.55 + 2.1, rz * 1.35 - 1.3);
    dy += (rd2 - 0.35) * 0.26 * mtnW * U_ELEV;
    const nd = fbm2(x * 0.55, z * 0.55);
    dy += (nd - 0.4) * 0.07 * mtnW * U_ELEV;
  } else {
    dy += (md - 0.45) * 0.04 * U_ELEV * landW;
  }
  const terraceW =
    smoothstep(0.32, 0.38, elev) * (1 - smoothstep(0.5, 0.55, elev)) * (1 - mtnW);
  dy += terraceW * 0.04 * U_ELEV * landW;
  return dy;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
