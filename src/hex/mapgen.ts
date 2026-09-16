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

/** Ridged noise for mountain spines. */
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
 * Seeded procedural map aiming for Civ / Humankind readability:
 * coastal shelves, mountain spines, forest belts, clustered biomes.
 */
export function generateMap(opts: MapGenOptions): HexMap {
  const width = opts.width ?? 40;
  const height = opts.height ?? 32;
  const seed = opts.seed | 0;
  const originQ = -Math.floor(width / 2);
  const originR = -Math.floor(height / 2);
  const map = new HexMap(width, height, originQ, originR);
  const rng = mulberry32(seed);

  // Precompute land elevation field for neighbor-aware terrace quantization
  const elevField = new Float32Array(width * height);
  const landField = new Float32Array(width * height);

  map.forEach((cell, lq, lr) => {
    const nx = lq / width;
    const ny = lr / height;

    // Domain-warped continent shape
    const warpX = fbm(nx * 2.0, ny * 2.0, seed + 200) - 0.5;
    const warpY = fbm(nx * 2.0 + 5.0, ny * 2.0, seed + 201) - 0.5;
    const wx = nx + warpX * 0.18;
    const wy = ny + warpY * 0.18;

    const continent = fbm(wx * 2.8, wy * 2.8, seed, 5);
    const elevNoise = fbm(wx * 5.0 + 10, wy * 5.0, seed + 7, 4);
    // Mountain spine (ridged) — Civ mountain ranges
    const spine = ridge(wx * 3.5 + 0.5, wy * 3.5, seed + 77, 5);
    // Soft edge falloff → ocean shelf
    const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny);
    const edge = Math.pow(Math.max(0, edgeDist * 2.4), 1.15);

    let landMass = continent * 0.55 + elevNoise * 0.25 + spine * 0.22 + edge * 0.28 - 0.4;
    // Carve secondary gulfs
    const gulf = fbm(wx * 6.0 + 90, wy * 6.0, seed + 40, 3);
    if (gulf < 0.32 && edgeDist < 0.35) landMass -= 0.18;

    landField[lr * width + lq] = landMass;

    let elev = 0;
    if (landMass >= -0.06) {
      elev = Math.min(1, Math.max(0, (landMass + elevNoise * 0.35 + spine * 0.4) * 0.95));
      // Boost along mountain spine
      if (spine > 0.55) elev = Math.min(1, elev + (spine - 0.55) * 0.7);
      // Humankind-style terrace quantization (4 tiers)
      const tier = Math.floor(elev * 4.0);
      elev = (tier + 0.35 + (hash2(cell.q, cell.r, seed + 3) * 0.3)) / 4.0;
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

    const warpX = fbm(nx * 2.0, ny * 2.0, seed + 200) - 0.5;
    const warpY = fbm(nx * 2.0 + 5.0, ny * 2.0, seed + 201) - 0.5;
    const wx = nx + warpX * 0.18;
    const wy = ny + warpY * 0.18;

    const moistNoise = fbm(wx * 3.5 + 20, wy * 3.5, seed + 13, 4);
    const tempNoise = fbm(wx * 2.2 + 40, wy * 2.2, seed + 19, 3);
    const spine = ridge(wx * 3.5 + 0.5, wy * 3.5, seed + 77, 5);
    const forestBelt = fbm(wx * 2.8 + 60, wy * 2.8, seed + 88, 4);

    let terrainId: TerrainId = Terrain.Plains;
    let featureId: FeatureId = Feature.None;
    let moisture = moistNoise;

    // Coastal distance estimate from landMass
    const coastal = landMass > -0.06 && landMass < 0.12;

    if (landMass < -0.06) {
      // Water: shallow shelf near coast, deep offshore
      terrainId = landMass < -0.28 ? Terrain.DeepWater : Terrain.ShallowWater;
      // Extra shallow ring
      if (landMass > -0.16) terrainId = Terrain.ShallowWater;
      elev = 0;
      moisture = 1;
    } else {
      const lat = Math.abs(ny - 0.5) * 2;
      const temp = 1 - lat * 0.8 + (tempNoise - 0.5) * 0.4;

      // Moisture: wetter near coasts and on windward of spines
      moisture = moistNoise * 0.7 + (coastal ? 0.25 : 0) + (1 - elev) * 0.1;
      moisture = Math.min(1, Math.max(0, moisture));

      if (elev > 0.7 || (spine > 0.62 && elev > 0.45)) {
        terrainId = Terrain.Mountains;
        elev = Math.max(elev, 0.78);
      } else if (elev > 0.48 || (spine > 0.5 && elev > 0.35)) {
        terrainId = Terrain.Hills;
      } else if (temp < 0.26) {
        terrainId = Terrain.Tundra;
      } else if (moisture < 0.3 && temp > 0.42) {
        // Desert clusters — arid belts
        const arid = fbm(wx * 2.5 + 120, wy * 2.5, seed + 50, 3);
        if (arid < 0.48 || moisture < 0.22) {
          terrainId = Terrain.Desert;
          if (hash2(q, r, seed + 44) < 0.4) featureId = Feature.Dunes;
        } else {
          terrainId = Terrain.Plains;
        }
      } else if (moisture > 0.52) {
        terrainId = Terrain.Grassland;
      } else {
        terrainId = Terrain.Plains;
      }

      // Forest belts (Civ-like contiguous woodlands along moisture ridges)
      if (
        terrainId !== Terrain.Mountains &&
        terrainId !== Terrain.Desert &&
        terrainId !== Terrain.Tundra
      ) {
        const belt = forestBelt * 0.55 + moisture * 0.45;
        const forestChance = belt * 0.7 + (1 - elev) * 0.1;
        // Cluster: require belt above threshold for contiguous forests
        if (belt > 0.48 && hash2(q, r, seed + 99) < forestChance * 0.75) {
          featureId = moisture > 0.68 && temp > 0.52 ? Feature.Rainforest : Feature.Forest;
        } else if (moisture > 0.62 && elev < 0.4 && hash2(q, r, seed + 100) < 0.35) {
          featureId = Feature.Forest;
        }
      }

      // Marsh on wet low grassland near water
      if (terrainId === Terrain.Grassland && moisture > 0.72 && elev < 0.32) {
        if (hash2(q, r, seed + 55) < 0.28) featureId = Feature.Marsh;
      }
      if (coastal && moisture > 0.6 && elev < 0.3 && terrainId === Terrain.Grassland) {
        if (hash2(q, r, seed + 56) < 0.15) featureId = Feature.Marsh;
      }

      if (terrainId === Terrain.Desert && moisture > 0.5 && hash2(q, r, seed + 66) < 0.1) {
        featureId = Feature.Oasis;
      }
      if (terrainId === Terrain.Tundra) {
        moisture = Math.min(moisture, 0.35);
      }
    }

    // Micro jitter
    if (terrainId !== Terrain.ShallowWater && terrainId !== Terrain.DeepWater) {
      elev = Math.min(1, Math.max(0, elev + (hash2(q, r, seed + 3) - 0.5) * 0.03));
    }

    cell.terrainId = terrainId;
    cell.featureId = featureId;
    cell.elev = elev;
    cell.moisture = moisture;
  });

  // Second pass: smooth shallow water rings around coasts (Civ coastal shelf)
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
      if (
        n.terrainId !== Terrain.DeepWater &&
        n.terrainId !== Terrain.ShallowWater
      ) {
        cell.terrainId = Terrain.ShallowWater;
        break;
      }
    }
  });

  map.recomputeEdgeMasks();
  void rng();
  return map;
}
