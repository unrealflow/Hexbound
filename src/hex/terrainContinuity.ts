import { AXIAL_DIRS, HEX_SIZE, axialRound, axialToWorld, hexCornerOffset, worldToAxialFrac } from './coords';
import { HexMap, Terrain } from './HexMap';

export const ELEV_SCALE = 2.0;
export const CLIFF_DROP = 0.50;
export const RAMP_DROP = 0.14;

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
 */
export const WATER_Y = 0.02;

export function cellTopY(map: HexMap, lq: number, lr: number): number {
  if (!map.inBoundsLocal(lq, lr)) return WATER_Y;
  const cell = map.getLocal(lq, lr);
  if (isWaterTerrain(cell.terrainId)) return WATER_Y;
  let sum = cell.elev;
  let n = 1;
  let cliff = 0;
  for (const d of AXIAL_DIRS) {
    const nq = lq + d.q;
    const nr = lr + d.r;
    if (!map.inBoundsLocal(nq, nr)) continue;
    const nc = map.getLocal(nq, nr);
    if (isWaterTerrain(nc.terrainId)) continue;
    const diff = Math.abs(nc.elev - cell.elev);
    if (diff > 0.22) cliff = Math.max(cliff, diff);
    sum += nc.elev;
    n++;
  }
  const smoothed = sum / n;
  // Keep real escarpments: blend the smoothed value back toward the raw height
  // as the local relief grows, so cliffs survive while flats stop stepping.
  const keep = Math.min(1, cliff / 0.45);
  const e = smoothed + (cell.elev - smoothed) * keep;
  return e * ELEV_SCALE;
}

export function rawElev(map: HexMap, lq: number, lr: number): number {
  if (!map.inBoundsLocal(lq, lr) || isWaterLocal(map, lq, lr)) return 0;
  return map.getLocal(lq, lr).elev;
}

export function rawMountainW(map: HexMap, lq: number, lr: number): number {
  if (!map.inBoundsLocal(lq, lr) || isWaterLocal(map, lq, lr)) return 0;
  const e = map.getLocal(lq, lr).elev;
  const t = Math.min(1, Math.max(0, (e - 0.38) / 0.24));
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
  const ys = hexes.map(([q, r]) => cellTopY(map, q, r));
  const span = Math.max(...ys) - Math.min(...ys);
  if (span < CLIFF_DROP) {
    const vals = hexes.map(([q, r]) => getter(map, q, r));
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return getter(map, selfLq, selfLr);
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
  const span = Math.max(...ys) - Math.min(...ys);

  // Coastal apron: a corner shared with water never becomes a vertical wall.
  // The land edge slopes down to a low lip so the shore reads as a beach
  // instead of a floating hex block with a pale skirt.
  let waterNbrs = 3 - hexes.length;
  for (const [q, r] of hexes) {
    if (cellTopY(map, q, r) <= 0.02 + 1e-6) waterNbrs++;
  }
  if (waterNbrs > 0) return 0.02;

  if (span < CLIFF_DROP) return ys.reduce((a, b) => a + b, 0) / ys.length;
  return selfY;
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

/** CPU replica of land displace (xz domain + welded scalars). Tops only for micro/terrace. */
export function displaceLandY(
  x: number,
  z: number,
  elev: number,
  mountainW: number,
  faceKind: number,
  enableDisplace = true,
): number {
  const landMask = elev > 0.04 ? 1 : 0;
  let dy = 0;
  if (faceKind < 0.5 && landMask > 0.5) {
    const md = fbm2(x * 1.1, z * 1.1);
    const landAmp = 0.55 + 0.45 * mountainW;
    const cliffBoost = smoothstep(0.35, 0.85, elev) * 0.26;
    if (enableDisplace) {
      dy += ((md - 0.45) * 0.14 * landAmp + cliffBoost * elev) * U_ELEV * 0.7;
    } else {
      dy += (md - 0.45) * 0.04 * U_ELEV;
    }
  }
  if (enableDisplace && mountainW > 0.02) {
    const rd = ridgeFbm(x * 0.45, z * 0.45);
    dy += (rd - 0.32) * 0.55 * mountainW * U_ELEV;
    const nd = fbm2(x * 0.55, z * 0.55);
    dy += (nd - 0.4) * 0.12 * mountainW * U_ELEV;
  }
  if (faceKind < 0.5 && landMask > 0.5) {
    const terraceW =
      smoothstep(0.32, 0.38, elev) * (1 - smoothstep(0.5, 0.55, elev)) * (1 - mountainW);
    dy += terraceW * 0.04 * U_ELEV;
  }
  return dy;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
