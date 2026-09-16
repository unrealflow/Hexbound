/** Logical hex cell data for exploration-layer terrain validation. */

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
  /** 0..1 adjacency to water (shore foam) */
  edgeMask: number;
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

  /** Recompute shore edgeMask from neighboring water. */
  recomputeEdgeMasks(): void {
    const isWater = (t: number) => t === Terrain.ShallowWater || t === Terrain.DeepWater;
    this.forEach((cell, lq, lr) => {
      if (isWater(cell.terrainId)) {
        cell.edgeMask = 0;
        return;
      }
      let mask = 0;
      const dirs = [
        [1, 0],
        [1, -1],
        [0, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
      ];
      for (const [dq, dr] of dirs) {
        const nq = lq + dq;
        const nr = lr + dr;
        if (!this.inBoundsLocal(nq, nr)) continue;
        const n = this.getLocal(nq, nr);
        if (isWater(n.terrainId)) mask = Math.max(mask, n.terrainId === Terrain.ShallowWater ? 0.85 : 1);
      }
      cell.edgeMask = mask;
    });
  }
}
