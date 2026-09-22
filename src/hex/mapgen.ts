import { Feature, HexMap, Terrain, type FeatureId, type TerrainId } from './HexMap';
import { computeHydrology, CHANNEL_AREA_THRESHOLD, type HydrologyResult } from './hydrology';
import { AXIAL_DIRS } from './coords';

/** Tiny seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x + seed * 374761393, 668265263) ^ Math.imul(y, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function ridge(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2(x * freq, y * freq, seed + i * 131);
    const r = 1 - Math.abs(n * 2 - 1);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

export interface MapGenOptions {
  seed: number;
  width?: number;
  height?: number;
}

/**
 * Look-workflow P1 (docs/design/2026-09-19-hexbound-look-workflow.md §2): the
 * legacy `max(spine, spine2)` ridge fields glue into one dome-shaped massif.
 * Chain parameters add seeded polyline ridge chains — separate crests with a
 * valley between, beaded into distinct peaks — which is the composition the
 * Civ6 reference reads as. All default to OFF (legacy topology); the sweep
 * grid picks the shipped values.
 */
export interface LookParams {
  /** Ridge chains. 0 = legacy spine-only topology. */
  chainCount: number;
  /** Peak elevation boost on a chain core (elev units). */
  chainAmp: number;
  /** Chain half-width in cells. */
  chainWidth: number;
  /** How much of the legacy base elevation survives under/between chains —
   *  lower reads as a wider inter-chain valley + piedmont belt. */
  baseKeep: number;
  /** Shore flattening skips cells whose chain mask exceeds this (a ridge that
   *  reaches the sea keeps its slope instead of being shaved into a bun). */
  shoreExempt: number;
  /** Chain mask above this forces Mountains, so arid belts cannot paint a
   *  ridge cream. */
  mountainGate: number;
  /** Desert only below this elevation — keeps arid belts off the highlands. */
  desertElevMax: number;
  /** Multiplier on the legacy quadratic spine boost. With chains on, the
   *  legacy boost is what glues the dome back together — keep ~0.3. */
  spineBoostKeep: number;
}

export const DEFAULT_LOOK: LookParams = {
  // Sweep winner C1 (docs/shots/_sweep-p1-c/, seed 20260916): three beaded
  // chains own the peaks, the legacy spine drops to texture level, and the
  // inter-chain valley + piedmont belt reads green below the crests.
  chainCount: 3,
  chainAmp: 0.8,
  chainWidth: 3.5,
  baseKeep: 0.58,
  shoreExempt: 0.45,
  mountainGate: 0.5,
  desertElevMax: 0.42,
  spineBoostKeep: 0.12,
};

interface ChainPoint {
  x: number;
  y: number;
  a: number;
}

/** One beaded polyline per chain, in cell coords, deterministic per seed. */
function buildChains(width: number, height: number, seed: number, look: LookParams): ChainPoint[][] {
  const chains: ChainPoint[][] = [];
  for (let k = 0; k < look.chainCount; k++) {
    const rand = mulberry32(seed + 7000 + k * 131);
    const ang = (k / Math.max(1, look.chainCount)) * Math.PI + 0.4 + rand() * 0.6;
    const cx = width * (0.5 + (rand() - 0.5) * 0.24);
    const cy = height * (0.5 + (rand() - 0.5) * 0.24);
    const halfLen = Math.min(width, height) * (0.42 + rand() * 0.12);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const w1 = (2 + rand() * 2) * Math.PI;
    const p1 = rand() * Math.PI * 2;
    const w2 = (5 + rand() * 3) * Math.PI;
    const p2 = rand() * Math.PI * 2;
    const wp = (3 + rand() * 2) * Math.PI;
    const pp = rand() * Math.PI * 2;
    const M = 48;
    const pts: ChainPoint[] = [];
    for (let m = 0; m <= M; m++) {
      const t = m / M;
      const along = (t - 0.5) * 2 * halfLen;
      const perp = height * (0.05 * Math.sin(t * w1 + p1) + 0.028 * Math.sin(t * w2 + p2));
      const x = cx + dx * along - dy * perp;
      const y = cy + dy * along + dx * perp;
      const taper = sstep(t / 0.12) * (1 - sstep((t - 0.88) / 0.12));
      const amp = Math.max(0, 0.55 + 0.45 * Math.sin(t * wp + pp)) * taper;
      pts.push({ x, y, a: amp });
    }
    chains.push(pts);
  }
  return chains;
}

function sstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Peak-node mask at a cell: max over chains of amplitude x (1-d/w)^2 falloff. */
function chainMaskAt(chains: ChainPoint[][], x: number, y: number, look: LookParams): number {
  let mask = 0;
  for (const pts of chains) {
    for (const p of pts) {
      if (p.a <= 0) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d >= look.chainWidth) continue;
      const u = 1 - d / look.chainWidth;
      const v = p.a * u * u;
      if (v > mask) mask = v;
    }
  }
  return mask;
}

/** Filled by the last generateMap call (P1 one-shot stats). */
export const p1Stats = {
  forestBlobsBefore: 0,
  forestBlobsAfter: 0,
  forestIsolatesBefore: 0,
  forestIsolatesAfter: 0,
  riverPathCells: 0,
};

/**
 * Seeded procedural map — larger coherent biomes, clearer coasts & mountain spines
 * (Civ / Humankind readability; avoids sparse white-ish hex noise).
 */
export function generateMap(opts: MapGenOptions & { look?: Partial<LookParams> }): HexMap {
  const width = opts.width ?? 40;
  const height = opts.height ?? 32;
  const seed = opts.seed | 0;
  const look: LookParams = { ...DEFAULT_LOOK, ...opts.look };
  const chains = buildChains(width, height, seed, look);
  const originQ = -Math.floor(width / 2);
  const originR = -Math.floor(height / 2);
  const map = new HexMap(width, height, originQ, originR);
  const rng = mulberry32(seed);

  const elevField = new Float32Array(width * height);
  const landField = new Float32Array(width * height);
  const chainMask = new Float32Array(width * height);

  map.forEach((_cell, lq, lr) => {
    const nx = lq / width;
    const ny = lr / height;
    const mask = chainMaskAt(chains, lq, lr, look);
    chainMask[lr * width + lq] = mask;

    // Lower-frequency domain warp → larger landmasses
    const warpX = fbm(nx * 1.2, ny * 1.2, seed + 200, 3) - 0.5;
    const warpY = fbm(nx * 1.2 + 5.0, ny * 1.2, seed + 201, 3) - 0.5;
    const wx = nx + warpX * 0.22;
    const wy = ny + warpY * 0.22;

    // Continent: mid frequency + strong ocean shelf falloff
    const continent = fbm(wx * 2.0, wy * 2.0, seed, 5);
    const elevNoise = fbm(wx * 4.0 + 10, wy * 4.0, seed + 7, 4);
    // Mountain spine — anisotropic secondary ridge keeps ranges narrow (Civ feel)
    const spine = ridge(wx * 3.2 + 0.5, wy * 2.4, seed + 77, 5);
    const spine2 = ridge(wx * 5.4 - 1.2, wy * 1.35 + 0.8, seed + 91, 4);
    const spineMix = Math.max(spine * 0.95, spine2 * 0.55);

    const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny);
    // Soft land only in interior; outer ~25% trends ocean
    const edge = Math.pow(Math.max(0, (edgeDist - 0.06) * 2.8), 1.2);

    // Bias toward ocean: need continent+edge to overcome -0.55 threshold
    let landMass =
      continent * 0.52 + elevNoise * 0.12 + spineMix * 0.14 + edge * 0.5 - 0.42;
    const gulf = fbm(wx * 5.0 + 90, wy * 5.0, seed + 40, 3);
    if (gulf < 0.32 && edgeDist < 0.38) landMass -= 0.14;
    // Inland lakes (sparse)
    if (gulf > 0.78 && edgeDist > 0.28 && continent < 0.5) landMass -= 0.18;

    landField[lr * width + lq] = landMass;

    let elev = 0;
    if (landMass >= 0.0) {
      // Most land stays low; peaks concentrate on spines (narrower, taller)
      // and, when chains are enabled, on the beaded chain cores. baseKeep
      // compresses the legacy base so the inter-chain valley + piedmont belt
      // read below the crests.
      let e = (0.12 + elevNoise * 0.26 + Math.max(0, landMass) * 0.36) * look.baseKeep;
      if (spineMix > 0.36) {
        const s = spineMix - 0.36;
        e += (s * s * 2.4 + s * 0.85) * look.spineBoostKeep;
      }
      e += mask * look.chainAmp;
      elev = Math.min(1, Math.max(0.08, e));
    }
    elevField[lr * width + lq] = elev;
  });

  // Shore ramp. A corner that touches water is pinned to the sea surface, so the
  // land's own height at the coast is the whole lip of the beach: at ELEV_SCALE 4
  // the old coastal heights would stand as a cliff ring around every landmass.
  // Land within two cells of the coast is scaled down instead, which keeps the
  // beach profile the map already had, while a mountain that reaches the sea
  // still ends in a sea cliff.
  const shoreCells = new Float32Array(width * height).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < shoreCells.length; i++) {
    if (landField[i]! < 0) {
      shoreCells[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const lq = i % width;
    const lr = (i - lq) / width;
    for (const d of AXIAL_DIRS) {
      const nq = lq + d.q;
      const nr = lr + d.r;
      if (nq < 0 || nr < 0 || nq >= width || nr >= height) continue;
      const j = nr * width + nq;
      if (shoreCells[j]! > shoreCells[i]! + 1) {
        shoreCells[j] = shoreCells[i]! + 1;
        queue.push(j);
      }
    }
  }
  for (let i = 0; i < elevField.length; i++) {
    // A chain core reaching the sea keeps its slope: flattening it would shave
    // the ridge into a bun right where the reference reads a mountain arm.
    if (chainMask[i]! > look.shoreExempt) continue;
    const dist = shoreCells[i]!;
    if (!(dist > 0) || !Number.isFinite(dist)) continue;
    const t = Math.min(1, (dist - 1) / 2);
    elevField[i] = elevField[i]! * (0.30 + 0.70 * (t * t * (3 - 2 * t)));
  }

  map.forEach((cell, lq, lr) => {
    const q = cell.q;
    const r = cell.r;
    const nx = lq / width;
    const ny = lr / height;
    const landMass = landField[lr * width + lq]!;
    let elev = elevField[lr * width + lq]!;

    const warpX = fbm(nx * 1.2, ny * 1.2, seed + 200, 3) - 0.5;
    const warpY = fbm(nx * 1.2 + 5.0, ny * 1.2, seed + 201, 3) - 0.5;
    const wx = nx + warpX * 0.22;
    const wy = ny + warpY * 0.22;

    // Low-frequency moisture / temp → large biome regions
    const moistNoise = fbm(wx * 1.8 + 20, wy * 1.8, seed + 13, 4);
    const tempNoise = fbm(wx * 1.4 + 40, wy * 1.4, seed + 19, 3);
    const spine = ridge(wx * 3.2 + 0.5, wy * 2.4, seed + 77, 5);
    const spine2 = ridge(wx * 5.4 - 1.2, wy * 1.35 + 0.8, seed + 91, 4);
    const spineMix = Math.max(spine * 0.95, spine2 * 0.55);
    const forestBelt = fbm(wx * 1.6 + 60, wy * 1.6, seed + 88, 4);
    const aridBelt = fbm(wx * 1.5 + 120, wy * 1.5, seed + 50, 3);

    let terrainId: TerrainId = Terrain.Plains;
    let featureId: FeatureId = Feature.None;
    let moisture = moistNoise;
    let forestCover = 0;

    const coastal = landMass >= 0.0 && landMass < 0.12;

    if (landMass < 0.0) {
      // Broader shallow shelf for Civ/HK turquoise→navy layering
      terrainId = landMass < -0.12 ? Terrain.DeepWater : Terrain.ShallowWater;
      if (landMass > -0.04) terrainId = Terrain.ShallowWater;
      elev = 0;
      moisture = 1;
    } else {
      const lat = Math.abs(ny - 0.5) * 2;
      const temp = 1 - lat * 0.75 + (tempNoise - 0.5) * 0.35;

      moisture = moistNoise * 0.75 + (coastal ? 0.25 : 0) + (1 - elev) * 0.1;
      moisture = Math.min(1, Math.max(0, moisture));

      const mask = chainMask[lr * width + lq]!;
      if (elev > 0.58 || (spineMix > 0.52 && elev > 0.40) || mask > look.mountainGate) {
        terrainId = Terrain.Mountains;
      } else if (elev > 0.38 || (spineMix > 0.44 && elev > 0.28) || mask > look.mountainGate * 0.5) {
        terrainId = Terrain.Hills;
      } else if (temp < 0.22) {
        terrainId = Terrain.Tundra;
      } else if (
        elev < look.desertElevMax &&
        ((aridBelt < 0.4 && moisture < 0.36 && temp > 0.42) || moisture < 0.18)
      ) {
        // Desert stays on low dry ground: an arid belt over a highland painted
        // the central dome cream, which is exactly the Civ6 anti-reference.
        terrainId = Terrain.Desert;
        if (hash2(q, r, seed + 44) < 0.45) featureId = Feature.Dunes;
      } else if (moisture > 0.45) {
        terrainId = Terrain.Grassland;
      } else {
        terrainId = Terrain.Plains;
      }

      // Continuous forest cover — no per-hex 0/1 hash. featureId is UI only.
      if (
        terrainId !== Terrain.Mountains &&
        terrainId !== Terrain.Desert &&
        terrainId !== Terrain.Tundra
      ) {
        const belt = forestBelt * 0.55 + moisture * 0.45;
        const moistBoost = moisture > 0.52 && elev < 0.45 ? 0.12 : 0;
        forestCover = Math.min(1, Math.max(0, belt + moistBoost));
        if (forestCover > 0.45) {
          featureId = moisture > 0.58 && temp > 0.45 ? Feature.Rainforest : Feature.Forest;
        }
      }

      if (terrainId === Terrain.Grassland && moisture > 0.7 && elev < 0.3) {
        if (hash2(q, r, seed + 55) < 0.3) featureId = Feature.Marsh;
      }
      if (coastal && moisture > 0.55 && elev < 0.28 && terrainId === Terrain.Grassland) {
        if (hash2(q, r, seed + 56) < 0.18) featureId = Feature.Marsh;
      }
      if (terrainId === Terrain.Desert && moisture > 0.48 && hash2(q, r, seed + 66) < 0.12) {
        featureId = Feature.Oasis;
      }
      if (terrainId === Terrain.Tundra) {
        moisture = Math.min(moisture, 0.35);
      }
    }

    if (terrainId !== Terrain.ShallowWater && terrainId !== Terrain.DeepWater) {
      elev = Math.min(1, Math.max(0, elev + (hash2(q, r, seed + 3) - 0.5) * 0.025));
    }

    cell.terrainId = terrainId;
    cell.featureId = featureId;
    cell.elev = elev;
    cell.moisture = moisture;
    cell.forestCover = forestCover;
    cell.riverDist = terrainId === Terrain.ShallowWater || terrainId === Terrain.DeepWater ? 0 : 1;
  });

  // Coastal shallow ring
  map.forEach((cell, lq, lr) => {
    if (cell.terrainId !== Terrain.DeepWater) return;
    const dirs = [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ];
    for (const [dq, dr] of dirs) {
      const nq = lq + dq!;
      const nr = lr + dr!;
      if (!map.inBoundsLocal(nq, nr)) continue;
      const n = map.getLocal(nq, nr);
      if (n.terrainId !== Terrain.DeepWater && n.terrainId !== Terrain.ShallowWater) {
        cell.terrainId = Terrain.ShallowWater;
        break;
      }
    }
  });

  // Soften biome speckles: majority filter on land biomes (1 pass)
  const snap: number[] = [];
  map.forEach((cell) => {
    snap.push(cell.terrainId);
  });
  map.forEach((cell, lq, lr) => {
    if (
      cell.terrainId === Terrain.DeepWater ||
      cell.terrainId === Terrain.ShallowWater ||
      cell.terrainId === Terrain.Mountains
    ) {
      return;
    }
    const counts = new Map<number, number>();
    let bestTid = cell.terrainId as number;
    let bestN = 0;
    const dirs = [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ];
    for (const dir of dirs) {
      const nq = lq + dir[0]!;
      const nr = lr + dir[1]!;
      if (!map.inBoundsLocal(nq, nr)) continue;
      const tid = snap[nr * width + nq]!;
      if (tid >= Terrain.ShallowWater || tid === Terrain.Mountains) continue;
      const c = (counts.get(tid) ?? 0) + 1;
      counts.set(tid, c);
      if (c > bestN) {
        bestN = c;
        bestTid = tid;
      }
    }
    if (bestN >= 4 && bestTid !== cell.terrainId && bestTid <= Terrain.Hills) {
      cell.terrainId = bestTid as TerrainId;
    }
  });

  coalesceForestCover(map);

  // G-Hydro M1+M2 (goals §2.4): S1/S2 topology on the pre-carve field, then S3
  // carves the real channel network from that tree, then S1/S2 again on the
  // final field so hydro:check asserts what ships.
  const hy0 = computeHydrology(map, seed);
  carveChannels(map, hy0);
  recomputeRiverDist(map, hy0);
  map.hydrology = computeHydrology(map, seed);

  map.recomputeEdgeMasks();
  map.recomputeShoreDepth();
  void rng();
  return map;
}

const AXIAL6: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

function isWaterId(t: number): boolean {
  return t === Terrain.ShallowWater || t === Terrain.DeepWater;
}

function forestBlobCount(cover: number[], w: number, h: number): { blobs: number; isolates: number } {
  const seen = new Uint8Array(cover.length);
  let blobs = 0;
  let isolates = 0;
  for (let i = 0; i < cover.length; i++) {
    if (cover[i]! <= 0.45 || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let size = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      size++;
      const lr = Math.floor(idx / w);
      const lq = idx - lr * w;
      for (const [dq, dr] of AXIAL6) {
        const nq = lq + dq;
        const nr = lr + dr;
        if (nq < 0 || nr < 0 || nq >= w || nr >= h) continue;
        const nIdx = nr * w + nq;
        if (seen[nIdx] || cover[nIdx]! <= 0.45) continue;
        seen[nIdx] = 1;
        stack.push(nIdx);
      }
    }
    blobs++;
    if (size === 1) isolates++;
  }
  return { blobs, isolates };
}

/** 6-neighbor majority on forestCover: kill pepper, fill holes. */
function coalesceForestCover(map: HexMap): void {
  const snap: number[] = [];
  map.forEach((cell) => snap.push(cell.forestCover));
  const before = forestBlobCount(snap, map.width, map.height);
  map.forEach((cell, lq, lr) => {
    if (isWaterId(cell.terrainId) || cell.terrainId === Terrain.Mountains) {
      cell.forestCover = 0;
      return;
    }
    // De-speckle only: drop a lone forest cell with <=1 forested neighbor.
    // No tail snapping — the field must stay continuous in (0.05, 0.95).
    let forestedNbrs = 0;
    for (const [dq, dr] of AXIAL6) {
      const nq = lq + dq;
      const nr = lr + dr;
      if (!map.inBoundsLocal(nq, nr)) continue;
      if (snap[nr * map.width + nq]! > 0.2) forestedNbrs++;
    }
    if (forestedNbrs <= 1) cell.forestCover = 0;
    if (cell.forestCover > 0.45) {
      if (cell.featureId === Feature.None || cell.featureId === Feature.Forest || cell.featureId === Feature.Rainforest) {
        cell.featureId = cell.moisture > 0.58 ? Feature.Rainforest : Feature.Forest;
      }
    } else if (cell.featureId === Feature.Forest || cell.featureId === Feature.Rainforest) {
      cell.featureId = Feature.None;
    }
  });
  const afterCover: number[] = [];
  map.forEach((c) => afterCover.push(c.forestCover));
  const after = forestBlobCount(afterCover, map.width, map.height);
  p1Stats.forestBlobsBefore = before.blobs;
  p1Stats.forestIsolatesBefore = before.isolates;
  p1Stats.forestBlobsAfter = after.blobs;
  p1Stats.forestIsolatesAfter = after.isolates;
}

/** S3 (goals §2.4): carve the real channel network from the S1/S2 receiver
 *  tree, replacing the old greedy-walk fake river. Depth is a smoothed
 *  stream-power static approx (K*sqrt(A)*slope, capped), the smoothed field is
 *  the "过与 cellTopY 同型平滑核" of the spec, and the bed is forced to descend
 *  along the tree (mouth processed first) so the carve cannot create sills. */
function carveChannels(map: HexMap, hy: HydrologyResult): void {
  const n = map.width * map.height;
  const channel = new Uint8Array(n);
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cell = map.getLocal(i % map.width, Math.floor(i / map.width));
    if (isWaterId(cell.terrainId)) continue;
    if (hy.area[i]! < CHANNEL_AREA_THRESHOLD) continue;
    channel[i] = 1;
    const r = hy.receiver[i]!;
    const slope = r >= 0 ? Math.max(0.004, hy.filled[i]! - hy.filled[r]!) : 0.02;
    depth[i] = Math.min(0.12, 0.18 * Math.sqrt(hy.area[i]!) * slope);
  }
  // Smooth the depth over the land neighbourhood (cellTopY-shaped 7-point
  // land mean, 2 passes) — this bevels the banks and keeps any planar
  // cross-section continuous (H3).
  let cur = depth;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(n);
    map.forEach((cell, lq, lr) => {
      const i = map.index(lq, lr);
      if (isWaterId(cell.terrainId)) return;
      let sum = cur[i]!;
      let cnt = 1;
      for (const [dq, dr] of AXIAL6) {
        const nq = lq + dq;
        const nr = lr + dr;
        if (!map.inBoundsLocal(nq, nr)) continue;
        const nb = map.getLocal(nq, nr);
        if (isWaterId(nb.terrainId)) continue;
        sum += cur[nr * map.width + nq]!;
        cnt++;
      }
      next[i] = sum / cnt;
    });
    cur = next;
  }
  // Mouth-first (descending area) so the downstream bed is final when an
  // upstream cell is written: bed never rises along the tree.
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (channel[i]) order.push(i);
  order.sort((a, b) => hy.area[b]! - hy.area[a]!);
  for (const i of order) {
    const cell = map.getLocal(i % map.width, Math.floor(i / map.width));
    let e = cell.elev - cur[i]!;
    const r = hy.receiver[i]!;
    if (r >= 0 && channel[r]) {
      const rc = map.getLocal(r % map.width, Math.floor(r / map.width));
      e = Math.max(e, rc.elev + 0.004);
    }
    cell.elev = Math.max(0.05, e);
  }
}

/** riverDist/Riverbank from the real channel (same 6-step BFS normalisation
 *  the shader's river-proximity band has always consumed). */
function recomputeRiverDist(map: HexMap, hy: HydrologyResult): void {
  const n = map.width * map.height;
  const dist = new Int16Array(n).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    const cell = map.getLocal(i % map.width, Math.floor(i / map.width));
    if (isWaterId(cell.terrainId)) {
      cell.riverDist = 0;
      continue;
    }
    if (hy.area[i]! >= CHANNEL_AREA_THRESHOLD) {
      dist[i] = 0;
      cell.riverDist = 0;
      cell.featureId = Feature.Riverbank;
      queue.push(i);
    } else {
      cell.riverDist = 1;
    }
  }
  const MAX_RIVER = 6;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const d = dist[idx]!;
    if (d >= MAX_RIVER) continue;
    const lr = Math.floor(idx / map.width);
    const lq = idx - lr * map.width;
    for (const [dq, dr] of AXIAL6) {
      const nq = lq + dq!;
      const nr = lr + dr!;
      if (!map.inBoundsLocal(nq, nr)) continue;
      const j = nr * map.width + nq;
      if (dist[j] !== -1) continue;
      const nb = map.getLocal(nq, nr);
      if (isWaterId(nb.terrainId)) continue;
      dist[j] = d + 1;
      queue.push(j);
    }
  }
  map.forEach((cell, lq, lr) => {
    if (isWaterId(cell.terrainId)) {
      cell.riverDist = 0;
      return;
    }
    const d = dist[map.index(lq, lr)]!;
    if (d > 0) cell.riverDist = Math.min(d, MAX_RIVER) / MAX_RIVER;
  });
}
