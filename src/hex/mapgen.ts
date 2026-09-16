import { Feature, HexMap, Terrain, type FeatureId, type TerrainId } from './HexMap';

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

  map.forEach((cell, lq, lr) => {
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
    const spineMix = Math.max(spine * 0.9, spine2 * 0.7);

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
      if (spineMix > 0.55) e += (spineMix - 0.55) * 1.25;
      else if (spineMix > 0.45) e += (spineMix - 0.45) * 0.55;
      elev = Math.min(1, Math.max(0.08, e));
      const tier = Math.floor(elev * 5.0);
      elev = (tier + 0.35 + hash2(cell.q, cell.r, seed + 3) * 0.3) / 5.0;
      elev = Math.min(1, Math.max(0.08, elev));
    }
    elevField[lr * width + lq] = elev;
  });

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
    const spineMix = Math.max(spine, spine2 * 0.85);
    const forestBelt = fbm(wx * 1.6 + 60, wy * 1.6, seed + 88, 4);
    const aridBelt = fbm(wx * 1.5 + 120, wy * 1.5, seed + 50, 3);

    let terrainId: TerrainId = Terrain.Plains;
    let featureId: FeatureId = Feature.None;
    let moisture = moistNoise;

    const coastal = landMass >= 0.0 && landMass < 0.12;

    if (landMass < 0.0) {
      terrainId = landMass < -0.12 ? Terrain.DeepWater : Terrain.ShallowWater;
      if (landMass > -0.06) terrainId = Terrain.ShallowWater;
      elev = 0;
      moisture = 1;
    } else {
      const lat = Math.abs(ny - 0.5) * 2;
      const temp = 1 - lat * 0.75 + (tempNoise - 0.5) * 0.35;

      moisture = moistNoise * 0.75 + (coastal ? 0.25 : 0) + (1 - elev) * 0.1;
      moisture = Math.min(1, Math.max(0, moisture));

      if (elev > 0.65 || (spineMix > 0.6 && elev > 0.45)) {
        terrainId = Terrain.Mountains;
        elev = Math.max(elev, 0.75);
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

      // Contiguous forest belts — denser on grassland/plains
      if (
        terrainId !== Terrain.Mountains &&
        terrainId !== Terrain.Desert &&
        terrainId !== Terrain.Tundra
      ) {
        const belt = forestBelt * 0.55 + moisture * 0.45;
        if (belt > 0.4 && hash2(q, r, seed + 99) < Math.min(0.92, belt * 0.95)) {
          featureId = moisture > 0.58 && temp > 0.45 ? Feature.Rainforest : Feature.Forest;
        } else if (moisture > 0.52 && elev < 0.45 && hash2(q, r, seed + 100) < 0.5) {
          featureId = Feature.Forest;
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

  map.recomputeEdgeMasks();
  void rng();
  return map;
}
