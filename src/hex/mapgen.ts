import { Feature, HexMap, Terrain, type FeatureId, type TerrainId } from './HexMap';
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
export function generateMap(opts: MapGenOptions): HexMap {
  const width = opts.width ?? 40;
  const height = opts.height ?? 32;
  const seed = opts.seed | 0;
  const originQ = -Math.floor(width / 2);
  const originR = -Math.floor(height / 2);
  const map = new HexMap(width, height, originQ, originR);
  const rng = mulberry32(seed);

  const elevField = new Float32Array(width * height);
  const landField = new Float32Array(width * height);

  map.forEach((_cell, lq, lr) => {
    const nx = lq / width;
    const ny = lr / height;

    // Lower-frequency domain warp → larger landmasses
    const warpX = fbm(nx * 1.2, ny * 1.2, seed + 200, 3) - 0.5;
    const warpY = fbm(nx * 1.2 + 5.0, ny * 1.2, seed + 201, 3) - 0.5;
    const wx = nx + warpX * 0.22;
    const wy = ny + warpY * 0.22;

    // Continent: mid frequency + strong ocean shelf falloff
    const continent = fbm(wx * 2.0, wy * 2.0, seed, 5);
    const elevNoise = fbm(wx * 4.0 + 10, wy * 4.0, seed + 7, 4);
    // Mountain spine — localized, not map-wide
    const spine = ridge(wx * 2.8 + 0.5, wy * 2.8, seed + 77, 5);
    const spine2 = ridge(wx * 4.2 - 1.2, wy * 1.6 + 0.8, seed + 91, 4);
    const spineMix = Math.max(spine * 0.9, spine2 * 0.45);

    const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny);
    // Soft land only in interior; outer ~25% trends ocean
    const edge = Math.pow(Math.max(0, (edgeDist - 0.06) * 2.8), 1.2);

    // Bias toward ocean: need continent+edge to overcome -0.55 threshold
    let landMass =
      continent * 0.52 + elevNoise * 0.14 + spineMix * 0.1 + edge * 0.5 - 0.42;
    const gulf = fbm(wx * 5.0 + 90, wy * 5.0, seed + 40, 3);
    if (gulf < 0.32 && edgeDist < 0.38) landMass -= 0.14;
    // Inland lakes (sparse)
    if (gulf > 0.78 && edgeDist > 0.28 && continent < 0.5) landMass -= 0.18;

    landField[lr * width + lq] = landMass;

    let elev = 0;
    if (landMass >= 0.0) {
      // Most land stays low; mountains only on strong spines
      let e = 0.15 + elevNoise * 0.3 + Math.max(0, landMass) * 0.4;
      if (spineMix > 0.48) e += (spineMix - 0.48) * 1.05;
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
    const spine = ridge(wx * 2.2 + 0.5, wy * 2.2, seed + 77, 5);
    const spine2 = ridge(wx * 3.8 - 1.2, wy * 1.4 + 0.8, seed + 91, 4);
    const spineMix = Math.max(spine * 0.9, spine2 * 0.45);
    const forestBelt = fbm(wx * 1.6 + 60, wy * 1.6, seed + 88, 4);
    const aridBelt = fbm(wx * 1.5 + 120, wy * 1.5, seed + 50, 3);

    let terrainId: TerrainId = Terrain.Plains;
    let featureId: FeatureId = Feature.None;
    let moisture = moistNoise;
    let forestCover = 0;

    const coastal = landMass >= 0.0 && landMass < 0.12;

    if (landMass < 0.0) {
      // Narrower shallow shelf → more true deep ocean (navy) for Humankind coasts
      terrainId = landMass < -0.06 ? Terrain.DeepWater : Terrain.ShallowWater;
      if (landMass > -0.02) terrainId = Terrain.ShallowWater;
      elev = 0;
      moisture = 1;
    } else {
      const lat = Math.abs(ny - 0.5) * 2;
      const temp = 1 - lat * 0.75 + (tempNoise - 0.5) * 0.35;

      moisture = moistNoise * 0.75 + (coastal ? 0.25 : 0) + (1 - elev) * 0.1;
      moisture = Math.min(1, Math.max(0, moisture));

      if (elev > 0.65 || (spineMix > 0.6 && elev > 0.45)) {
        terrainId = Terrain.Mountains;
      } else if (elev > 0.42 || (spineMix > 0.52 && elev > 0.32)) {
        terrainId = Terrain.Hills;
      } else if (temp < 0.22) {
        terrainId = Terrain.Tundra;
      } else if ((aridBelt < 0.4 && moisture < 0.36 && temp > 0.42) || moisture < 0.18) {
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
  carveValleys(map, rng);

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

/** Walk downhill from wet lowland seeds; store riverDist for later shading. */
function carveValleys(map: HexMap, rng: () => number): void {
  const seeds: { lq: number; lr: number; moist: number }[] = [];
  map.forEach((cell, lq, lr) => {
    if (isWaterId(cell.terrainId)) return;
    if (cell.elev < 0.28 && cell.moisture > 0.55) seeds.push({ lq, lr, moist: cell.moisture });
  });
  seeds.sort((a, b) => b.moist - a.moist);

  const onPath = new Uint8Array(map.width * map.height);
  let rivers = 0;
  const MAX_RIVERS = 6;
  for (const s of seeds) {
    if (rivers >= MAX_RIVERS) break;
    const start = map.index(s.lq, s.lr);
    if (onPath[start]) continue;
    const steps = 8 + Math.floor(rng() * 13);
    let lq = s.lq;
    let lr = s.lr;
    let prev = -1;
    const path: number[] = [];
    for (let k = 0; k < steps; k++) {
      const idx = map.index(lq, lr);
      if (onPath[idx]) break;
      const cell = map.getLocal(lq, lr);
      if (isWaterId(cell.terrainId)) break;
      path.push(idx);
      onPath[idx] = 1;
      let bestQ = lq;
      let bestR = lr;
      let bestE = 99;
      let found = false;
      let hitWater = false;
      for (const [dq, dr] of AXIAL6) {
        const nq = lq + dq;
        const nr = lr + dr;
        if (!map.inBoundsLocal(nq, nr)) continue;
        const nIdx = map.index(nq, nr);
        if (nIdx === prev) continue;
        const n = map.getLocal(nq, nr);
        if (isWaterId(n.terrainId)) {
          hitWater = true;
          continue;
        }
        if (n.elev <= bestE) {
          bestE = n.elev;
          bestQ = nq;
          bestR = nr;
          found = true;
        }
      }
      if (!found) {
        if (hitWater) break;
        break;
      }
      prev = idx;
      lq = bestQ;
      lr = bestR;
    }
    if (path.length < 3) {
      for (const idx of path) onPath[idx] = 0;
      continue;
    }
    rivers++;
    p1Stats.riverPathCells += path.length;
    for (const idx of path) {
      const lr0 = Math.floor(idx / map.width);
      const lq0 = idx - lr0 * map.width;
      const c = map.getLocal(lq0, lr0);
      c.elev = Math.max(0.02, c.elev * 0.72);
      c.featureId = Feature.Riverbank;
      c.riverDist = 0;
    }
  }

  map.forEach((cell, lq, lr) => {
    if (isWaterId(cell.terrainId) || onPath[map.index(lq, lr)]) return;
    let beside = false;
    for (const [dq, dr] of AXIAL6) {
      const nq = lq + dq;
      const nr = lr + dr;
      if (!map.inBoundsLocal(nq, nr)) continue;
      if (onPath[map.index(nq, nr)]) {
        beside = true;
        break;
      }
    }
    if (beside) cell.elev = Math.max(0.02, cell.elev * 0.85);
  });

  const dist = new Int16Array(map.width * map.height).fill(-1);
  const queue: number[] = [];
  map.forEach((cell, lq, lr) => {
    const idx = map.index(lq, lr);
    if (onPath[idx]) {
      dist[idx] = 0;
      queue.push(idx);
      cell.riverDist = 0;
    }
  });
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
      const nIdx = map.index(nq, nr);
      if (dist[nIdx] !== -1) continue;
      const n = map.getLocal(nq, nr);
      if (isWaterId(n.terrainId)) continue;
      dist[nIdx] = d + 1;
      queue.push(nIdx);
    }
  }
  map.forEach((cell, lq, lr) => {
    if (isWaterId(cell.terrainId)) {
      cell.riverDist = 0;
      return;
    }
    const d = dist[map.index(lq, lr)]!;
    cell.riverDist = d < 0 ? 1 : Math.min(d, MAX_RIVER) / MAX_RIVER;
  });
}
