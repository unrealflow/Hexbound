/** Logical hex cell data for exploration-layer terrain validation. */

import { AXIAL_DIRS, HEX_SIZE, axialToWorld } from './coords';

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

  /**
   * Pack two WxH RGBA8 map fields for GPU upload.
   * tex1.B = water ? 0.5 + 0.5*shoreDist : 0.5 - 0.5*landShoreDist (signed
   *                        shore distance, 0 at the waterline)
   * tex1.R = water ? shoreDist : riverDist (both world-distance fields).
   */
  packMapTexels(): { tex0: Uint8Array; tex1: Uint8Array } {
    const n = this.width * this.height;
    const tex0 = new Uint8Array(n * 4);
    const tex1 = new Uint8Array(n * 4);
    const toU8 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    const isWater = (t: number) => t === Terrain.ShallowWater || t === Terrain.DeepWater;
    this.forEach((cell, lq, lr) => {
      const i = this.index(lq, lr) * 4;
      tex0[i] = toU8(cell.terrainId / 8);
      tex0[i + 1] = toU8(cell.featureId / 8);
      tex0[i + 2] = toU8(cell.elev);
      tex0[i + 3] = toU8(cell.moisture);
      tex1[i] = toU8(isWater(cell.terrainId) ? cell.shoreDist : cell.riverDist);
      tex1[i + 1] = toU8(cell.forestCover);
      tex1[i + 2] = toU8(isWater(cell.terrainId) ? 1 : cell.edgeMask);
      tex1[i + 3] = toU8(this.neighborElevRange(lq, lr));
    });
    return { tex0, tex1 };
  }
}
