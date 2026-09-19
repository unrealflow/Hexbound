/** Logical hex cell data for exploration-layer terrain validation. */

import { AXIAL_DIRS, HEX_SIZE, axialToWorld, hexCornerOffset } from './coords';

export const Terrain = {
  Plains: 0,
  Grassland: 1,
  Desert: 2,
  Tundra: 3,
  Hills: 4,
  Mountains: 5,
  ShallowWater: 6,
  DeepWater: 7,
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

export const Feature = {
  None: 0,
  Forest: 1,
  Rainforest: 2,
  Marsh: 3,
  Dunes: 4,
  Road: 5,
  Oasis: 6,
  Riverbank: 7,
} as const;
export type FeatureId = (typeof Feature)[keyof typeof Feature];

export const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Plains]: 'Plains',
  [Terrain.Grassland]: 'Grassland',
  [Terrain.Desert]: 'Desert',
  [Terrain.Tundra]: 'Tundra',
  [Terrain.Hills]: 'Hills',
  [Terrain.Mountains]: 'Mountains',
  [Terrain.ShallowWater]: 'ShallowWater',
  [Terrain.DeepWater]: 'DeepWater',
};

export const FEATURE_NAMES: Record<number, string> = {
  [Feature.None]: 'None',
  [Feature.Forest]: 'Forest',
  [Feature.Rainforest]: 'Rainforest',
  [Feature.Marsh]: 'Marsh',
  [Feature.Dunes]: 'Dunes',
  [Feature.Road]: 'Road',
  [Feature.Oasis]: 'Oasis',
  [Feature.Riverbank]: 'Riverbank',
};

export interface HexCell {
  q: number;
  r: number;
  terrainId: TerrainId;
  featureId: FeatureId;
  /** 0..1 elevation factor */
  elev: number;
  /** 0..1 moisture */
  moisture: number;
  /** 0..1 inverse world-distance to water: exp(-d / 0.28). Water is 0. */
  edgeMask: number;
  /**
   * Water only: world-distance from shoreline, normalized over 8 hex steps
   * (0 = land / shore, 1 = open ocean). Land cells are 0.
   */
  shoreDist: number;
  /** 0..1 continuous forest canopy cover (shader uses this, not featureId). */
  forestCover: number;
  /** Land: 0 on river path, 1 far. Water 0. Packed to uMapTex1.R on land. */
  riverDist: number;
  /**
   * Land only: world-distance to the nearest water cell, same normalization as
   * shoreDist (0 = shoreline, 1 = far inland). Water cells are 0. Packed into
   * uMapTex1.B as a signed field so shore bands read one continuous distance
   * instead of a per-cell water flag (which drew them along hex edges).
   */
  landShoreDist: number;
}

/** Kernel radii for packMapTextures, in cell steps (cell centres are sqrt(3)
 *  HEX_SIZE apart).
 *  AREA smooths the per-cell fields across their neighbours, which is what stops
 *  a cell painting as a flat hexagon. BAND smooths the distance fields that draw
 *  the shoreline and the foam about as much as the 4x4 cubic B-spline stencil
 *  they used before (an effective 2x2 cell average, equivalent to a centre weight
 *  of 0.44 here): pre-filtering them harder smeared the foam line into a wide
 *  shelf, and not filtering them at all left their window a sliver pinned to the
 *  cell boundary. */
const AREA_RADIUS_CELLS = 2.2;
const BAND_RADIUS_CELLS = 1.8;
/** Forest uses a tighter kernel so fractal upsample can own the edge shape. */
const FOREST_RADIUS_CELLS = 1.55;
/** World distance at which the baked signed shore distance saturates. */
const SHORE_RANGE = 3.8;

/** Tiny value-noise FBM for fractal upsample at bake time (paper §8 G2). */
function bakeHash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x + seed * 374761393, 668265263) ^ Math.imul(y, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function bakeValueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = bakeHash2(x0, y0, seed);
  const b = bakeHash2(x0 + 1, y0, seed);
  const c = bakeHash2(x0, y0 + 1, seed);
  const d = bakeHash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function bakeFbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * bakeValueNoise(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
/** Cell forestCover as low-freq amp + in-cell FBM detail → organic cover edges. */
function fractalUpsampleForest(base: number, wx: number, wz: number): number {
  if (base <= 0.02) return 0;
  const n1 = bakeFbm(wx * 0.85 + 3.1, wz * 0.85, 9101, 4);
  const n2 = bakeFbm(wx * 2.3 - 1.7, wz * 2.3 + 4.2, 9203, 3);
  const warp = bakeFbm(wx * 0.45 + 8.0, wz * 0.45, 9307, 3) - 0.5;
  const n3 = bakeFbm(wx * 1.4 + warp * 1.8, wz * 1.4 - warp * 1.5, 9409, 3);
  // Detail vanishes at 0/1 so open plains stay open and dense cores stay dense.
  const gate = 4.0 * base * (1 - base);
  let v = base + (n1 - 0.5) * 0.55 * gate + (n2 - 0.5) * 0.35 * gate;
  // Soft clump threshold in world space — breaks hex-shaped isocontours.
  v = v * 0.62 + n3 * 0.38 * Math.sqrt(Math.max(base, 0.001));
  return Math.max(0, Math.min(1, v));
}


export class HexMap {
  readonly width: number;
  readonly height: number;
  /** Origin offset so map is centered-ish: q in [0,w), r in [0,h) */
  readonly originQ: number;
  readonly originR: number;
  private cells: HexCell[];

  constructor(width: number, height: number, originQ = 0, originR = 0) {
    this.width = width;
    this.height = height;
    this.originQ = originQ;
    this.originR = originR;
    this.cells = new Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        this.cells[this.index(q, r)] = {
          q: originQ + q,
          r: originR + r,
          terrainId: Terrain.Plains,
          featureId: Feature.None,
          elev: 0,
          moisture: 0.4,
          edgeMask: 0,
          shoreDist: 0,
          forestCover: 0,
          riverDist: 1,
          landShoreDist: 0,
        };
      }
    }
  }

  index(localQ: number, localR: number): number {
    return localR * this.width + localQ;
  }

  inBoundsLocal(localQ: number, localR: number): boolean {
    return localQ >= 0 && localQ < this.width && localR >= 0 && localR < this.height;
  }

  /** Lookup by absolute axial coords. */
  get(q: number, r: number): HexCell | undefined {
    const lq = q - this.originQ;
    const lr = r - this.originR;
    if (!this.inBoundsLocal(lq, lr)) return undefined;
    return this.cells[this.index(lq, lr)];
  }

  getLocal(localQ: number, localR: number): HexCell {
    return this.cells[this.index(localQ, localR)];
  }

  setLocal(localQ: number, localR: number, partial: Partial<HexCell>): void {
    const c = this.cells[this.index(localQ, localR)];
    Object.assign(c, partial);
  }

  forEach(fn: (cell: HexCell, localQ: number, localR: number) => void): void {
    for (let r = 0; r < this.height; r++) {
      for (let q = 0; q < this.width; q++) {
        fn(this.cells[this.index(q, r)], q, r);
      }
    }
  }

  /**
   * Inverse world-distance to water on land: exp(-d / 0.28).
   * Water cells stay 0. d is hex-step BFS distance × HEX_SIZE.
   */
  recomputeEdgeMasks(): void {
    const isWater = (t: number) => t === Terrain.ShallowWater || t === Terrain.DeepWater;
    const water: { x: number; z: number }[] = [];
    this.forEach((cell) => {
      if (!isWater(cell.terrainId)) return;
      const w = this.worldOf(cell);
      water.push(w);
    });
    this.forEach((cell) => {
      if (isWater(cell.terrainId)) {
        cell.edgeMask = 0;
        return;
      }
      const w = this.worldOf(cell);
      let best = Infinity;
      for (const q of water) {
        const dx = q.x - w.x;
        const dz = q.z - w.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      cell.edgeMask = Number.isFinite(best) ? Math.exp(-Math.sqrt(best) / 0.28) : 0;
    });
  }

  /**
   * Water depth as a continuous Euclidean world distance to the nearest land
   * cell, normalized over 8 hex steps. The old BFS version quantized this to
   * eight discrete rings, which showed up as hexagonal depth terraces (and a
   * honeycomb sheen) on open water.
   */
  recomputeShoreDepth(): void {
    const isWater = (t: number) => t === Terrain.ShallowWater || t === Terrain.DeepWater;
    const NORM = 16 * HEX_SIZE;
    const land: { x: number; z: number }[] = [];
    const water: { x: number; z: number }[] = [];
    this.forEach((cell) => {
      if (isWater(cell.terrainId)) { water.push(this.worldOf(cell)); return; }
      land.push(this.worldOf(cell));
    });
    this.forEach((cell) => {
      if (!isWater(cell.terrainId)) {
        cell.shoreDist = 0;
        const w = this.worldOf(cell);
        let bw = Infinity;
        for (const wa of water) {
          const dx = wa.x - w.x;
          const dz = wa.z - w.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bw) bw = d2;
        }
        cell.landShoreDist = Number.isFinite(bw) ? Math.min(1, Math.sqrt(bw) / NORM) : 1;
        return;
      }
      const w = this.worldOf(cell);
      let best = Infinity;
      for (const l of land) {
        const dx = l.x - w.x;
        const dz = l.z - w.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      cell.shoreDist = Number.isFinite(best) ? Math.min(1, Math.sqrt(best) / NORM) : 1;
      cell.landShoreDist = 0;
    });
  }

  private worldOf(cell: HexCell): { x: number; z: number } {
    return axialToWorld(cell.q, cell.r, HEX_SIZE);
  }

  /** 6-neighbor elev range in 0..1 (missing neighbors skipped). */
  neighborElevRange(localQ: number, localR: number): number {
    let mn = 1;
    let mx = 0;
    let any = false;
    for (const d of AXIAL_DIRS) {
      const nq = localQ + d.q;
      const nr = localR + d.r;
      if (!this.inBoundsLocal(nq, nr)) continue;
      const e = this.getLocal(nq, nr).elev;
      mn = Math.min(mn, e);
      mx = Math.max(mx, e);
      any = true;
    }
    return any ? mx - mn : 0;
  }

  /** Per-cell channel values in packed order, as floats for filtering. */
  private cellChannels(): Float32Array {
    const ch = new Float32Array(this.width * this.height * 8);
    const isWater = (t: number) => t === Terrain.ShallowWater || t === Terrain.DeepWater;
    this.forEach((cell, lq, lr) => {
      const i = this.index(lq, lr) * 8;
      ch[i] = cell.terrainId / 8;
      ch[i + 1] = cell.featureId / 8;
      ch[i + 2] = cell.elev;
      ch[i + 3] = cell.moisture;
      ch[i + 4] = isWater(cell.terrainId) ? cell.shoreDist : cell.riverDist;
      ch[i + 5] = cell.forestCover;
      ch[i + 6] = isWater(cell.terrainId) ? 1 : cell.edgeMask;
      ch[i + 7] = this.neighborElevRange(lq, lr);
    });
    return ch;
  }

  /**
   * Hex edges between a water cell and a non-water cell, as segments carrying the
   * outward (seaward) normal: [ax, az, bx, bz, nx, nz] per segment. Used to bake
   * a real signed distance to the waterline, because the per-cell shore field is
   * constant over the whole sea, so depth and foam bands could only ever be the
   * interpolated sliver between a water and a land cell.
   */
  private shoreSegments(): Float64Array {
    const segs: number[] = [];
    const isWater = (t: number) => t === Terrain.ShallowWater || t === Terrain.DeepWater;
    this.forEach((cell, lq, lr) => {
      if (!isWater(cell.terrainId)) return;
      const cq = this.originQ + lq;
      const cr = this.originR + lr;
      const c = axialToWorld(cq, cr);
      for (const d of AXIAL_DIRS) {
        const n = this.get(cq + d.q, cr + d.r);
        // The map border is a hard edge, not a coastline.
        if (!n || isWater(n.terrainId)) continue;
        const nc = axialToWorld(cq + d.q, cr + d.r);
        const shared: { x: number; z: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const o = hexCornerOffset(i);
          const px = c.x + o.x;
          const pz = c.z + o.z;
          if (Math.hypot(px - nc.x, pz - nc.z) < 1.05) shared.push({ x: px, z: pz });
        }
        if (shared.length !== 2) continue;
        const [a, b] = shared;
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        const nx = c.x - mx;
        const nz = c.z - mz;
        const len = Math.hypot(nx, nz) || 1;
        segs.push(a.x, a.z, b.x, b.z, nx / len, nz / len);
      }
    });
    return Float64Array.from(segs);
  }

  /** Signed distance to the nearest shore segment, positive on the water side. */
  private static shoreDistance(segs: Float64Array, x: number, z: number): number {
    let best = Infinity;
    let sign = -1;
    for (let i = 0; i < segs.length; i += 6) {
      const ax = segs[i];
      const az = segs[i + 1];
      const vx = segs[i + 2] - ax;
      const vz = segs[i + 3] - az;
      const wx = x - ax;
      const wz = z - az;
      const len2 = vx * vx + vz * vz;
      let t = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - t * vx;
      const dz = wz - t * vz;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        sign = dx * segs[i + 4] + dz * segs[i + 5] >= 0 ? 1 : -1;
      }
    }
    return best === Infinity ? 0 : sign * Math.sqrt(best);
  }

  /**
   * Resample four channels at `sub` x `sub` positions per cell. A channel is
   * normally the weighted average of the cells around the subsample's own world
   * position, kernel (1 - d/r)^3 with d in cell steps and a per-channel radius r:
   * the kernel reaches zero at r with zero slope, so the field stays continuous
   * where a cell enters or leaves the support, and because each subsample mixes
   * its neighbours the result has no per-cell plateau for the shader to draw as a
   * hexagon. `{ dist: true }` instead stores the signed shore distance, positive
   * offshore on a scale that saturates SHORE_RANGE world units out.
   */
  private bakeRGBA(spec: { ch?: number; r?: number; dist?: boolean; fractalForest?: boolean }[], sub: number): {
    data: Uint8Array;
    width: number;
    height: number;
  } {
    const w = this.width * sub;
    const h = this.height * sub;
    const out = new Uint8Array(w * h * 4);
    const ch = this.cellChannels();
    const spacing = Math.sqrt(3) * HEX_SIZE;
    const radii = spec.map((s) => (s.r ?? 0) * spacing);
    const span = Math.ceil(Math.max(...spec.map((s) => s.r ?? 0)));
    const segs = spec.some((s) => s.dist) ? this.shoreSegments() : new Float64Array(0);
    const world: { x: number; z: number }[] = [];
    for (let r = 0; r < this.height; r++) {
      for (let q = 0; q < this.width; q++) {
        world.push(axialToWorld(this.originQ + q, this.originR + r));
      }
    }
    const toU8 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    const acc = new Float64Array(4);
    const wSum = new Float64Array(4);
    for (let lr = 0; lr < this.height; lr++) {
      for (let lq = 0; lq < this.width; lq++) {
        for (let j = 0; j < sub; j++) {
          for (let i = 0; i < sub; i++) {
            // Axial coords of this subsample: a cell centre sits at its integer
            // axial coordinate, so the subsamples straddle it at +/-(i+0.5)/sub.
            const p = axialToWorld(
              this.originQ + lq - 0.5 + (i + 0.5) / sub,
              this.originR + lr - 0.5 + (j + 0.5) / sub,
            );
            acc.fill(0);
            wSum.fill(0);
            for (let dr = -span; dr <= span; dr++) {
              for (let dq = -span; dq <= span; dq++) {
                const cq = lq + dq;
                const cr = lr + dr;
                if (!this.inBoundsLocal(cq, cr)) continue;
                const cw = world[cr * this.width + cq];
                const dx = cw.x - p.x;
                const dz = cw.z - p.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                const ci = this.index(cq, cr) * 8;
                for (let k = 0; k < spec.length; k++) {
                  if (spec[k].dist) continue;
                  if (d >= radii[k]) continue;
                  const t = 1 - d / radii[k];
                  const wt = t * t * t;
                  wSum[k] += wt;
                  acc[k] += wt * ch[ci + (spec[k].ch as number)];
                }
              }
            }
            const o = ((lr * sub + j) * w + lq * sub + i) * 4;
            for (let k = 0; k < spec.length; k++) {
              if (spec[k].dist) {
                const sd = HexMap.shoreDistance(segs, p.x, p.z) / SHORE_RANGE;
                out[o + k] = toU8(0.5 + 0.5 * Math.max(-1, Math.min(1, sd)));
              } else {
                let v = wSum[k] > 0 ? acc[k] / wSum[k] : 0;
                if (spec[k].fractalForest) v = fractalUpsampleForest(v, p.x, p.z);
                out[o + k] = toU8(v);
              }
            }
          }
        }
      }
    }
    return { data: out, width: w, height: h };
  }

  /**
   * Pack the map into two RGBA textures at `sub` x `sub` samples per cell:
   *   tex0 = terrainId/8, featureId/8, elev, moisture, filtered at area scale
   *   tex1 = water ? shoreDist : riverDist, forestCover, signed shore distance,
   *          neighbourElevRange
   * The fragment takes one bilinear tap per texture. The 4x4 cell stencil this
   * replaced averaged 16 cells at C2 and still painted each cell as a flat
   * hexagon, because the data itself is one value per cell: pre-filtering across
   * cells is what removes that, and it is cheaper by 30 texture fetches.
   *
   * A second, coarser level of the same fields was tried as a dual-scale
   * fine-minus-coarse boost. It measurably made things worse (rim-vs-interior
   * luminance went from +0.02 to +0.13): the fine level varies inside a cell
   * while the coarse one does not, so their difference is itself cell aligned and
   * boosting it re-amplifies exactly the structure the pre-filter removed.
   */
  packMapTextures(sub = 4): { tex0: Uint8Array; tex1: Uint8Array; width: number; height: number } {
    const A = AREA_RADIUS_CELLS;
    const B = BAND_RADIUS_CELLS;
    const F = FOREST_RADIUS_CELLS;
    const a = this.bakeRGBA(
      [
        { ch: 0, r: A },
        { ch: 1, r: A },
        { ch: 2, r: A },
        { ch: 3, r: A },
      ],
      sub,
    );
    const b = this.bakeRGBA(
      [
        { ch: 4, r: B },
        { ch: 5, r: F, fractalForest: true },
        { dist: true },
        { ch: 7, r: A },
      ],
      sub,
    );
    return { tex0: a.data, tex1: b.data, width: a.width, height: a.height };
  }
}
