/** Top-face (x,z) Y-span after CPU replica of land displace. */
import { generateMap } from '../src/hex/mapgen.ts';
import { HEX_SIZE, hexCornerOffset, axialToWorld, AXIAL_DIRS } from '../src/hex/coords.ts';
import {
  CLIFF_DROP,
  RAMP_DROP,
  ELEV_SCALE,
  isWaterTerrain,
  isWaterLocal,
  cellTopY,
  cornerTopY,
  rawElev,
  rawMountainW,
  rawForestW,
  weldCornerScalar,
  edgeNeighbour,
  avg7,
  displaceLandY,
  vertexSpanY,
} from '../src/hex/terrainContinuity.ts';
import { HexMap } from '../src/hex/HexMap.ts';

const map = generateMap({ seed: 20260916, width: 40, height: 32 });

type Key = string;
const groups = new Map<Key, { ys: number[]; spanCellY: number }>();

function key(x: number, z: number): Key {
  return `${Math.round(x * 10000) / 10000},${Math.round(z * 10000) / 10000}`;
}

function addTop(x: number, y: number, z: number, elevW: number, mW: number, spanCellY: number) {
  const dy = displaceLandY(x, z, elevW, mW, 0, true);
  const k = key(x, z);
  let g = groups.get(k);
  if (!g) {
    g = { ys: [], elevs: [], mws: [], spanCellY };
    groups.set(k, g);
  }
  g.ys.push(y + dy);
  g.elevs.push(elevW);
  g.mws.push(mW);
  g.spanCellY = Math.min(g.spanCellY, spanCellY);
}

map.forEach((cell, lq, lr) => {
  const isWater = isWaterTerrain(cell.terrainId);
  if (isWater) return;
  const yTopFlat = cell.elev * ELEV_SCALE;
  const { x: cxw, z: czw } = axialToWorld(cell.q, cell.r, HEX_SIZE);
  const elevC = avg7(map, lq, lr, rawElev);
  const mC = avg7(map, lq, lr, rawMountainW);
  addTop(cxw, yTopFlat + 0.015, czw, elevC, mC, 0);

  for (let i = 0; i < 6; i++) {
    const c = hexCornerOffset(i, HEX_SIZE);
    const y = cornerTopY(map, lq, lr, i, yTopFlat, isWater);
    const eW = weldCornerScalar(map, lq, lr, i, rawElev);
    const mW = weldCornerScalar(map, lq, lr, i, rawMountainW);
    addTop(cxw + c.x, y, czw + c.z, eW, mW, vertexSpanY(map, cxw + c.x, czw + c.z));
  }
});

let crackGroups = 0;
let attrCracks = 0;
let groupsN = 0;
for (const g of groups.values()) {
  if (g.ys.length < 2) continue;
  groupsN++;
  const span = Math.max(...g.ys) - Math.min(...g.ys);
  const eSpan = Math.max(...g.elevs) - Math.min(...g.elevs);
  const mSpan = Math.max(...g.mws) - Math.min(...g.mws);
  if (g.spanCellY < CLIFF_DROP) {
    if (span > 0.001) crackGroups++;
    if (eSpan > 1e-5 || mSpan > 1e-5) attrCracks++;
  }
}

let walls = 0;
let shoreWalls = 0;
let maxShoreWallDrop = 0;
let maxWallBottomGap = 0;
let lowDeltaWalls = 0;
let lowDeltaPairs = 0;
let trueWalls = 0;
map.forEach((cell, lq, lr) => {
  const isWater = isWaterTerrain(cell.terrainId);
  const yTopFlat = isWater ? 0.02 : cell.elev * ELEV_SCALE;
  const cornerYs: number[] = [];
  for (let i = 0; i < 6; i++) cornerYs.push(cornerTopY(map, lq, lr, i, yTopFlat, isWater));
  for (let i = 0; i < 6; i++) {
    const nb = edgeNeighbour(map, lq, lr, i);
    if (!nb) continue;
    const nq = nb[0];
    const nr = nb[1];
    const inB = map.inBoundsLocal(nq, nr);
    const nWater = isWaterLocal(map, nq, nr);
    const canon = inB && (lq < nq || (lq === nq && lr < nr));
    if (canon && !isWater && !nWater) {
      const n = map.getLocal(nq, nr);
      if (Math.abs(n.elev - cell.elev) < 0.07) lowDeltaPairs++;
    }
    const neighborTop = cellTopY(map, nq, nr);
    const yA = cornerYs[i]!;
    const yB = cornerYs[(i + 1) % 6]!;
    const yBotA = inB ? cornerTopY(map, nq, nr, i, neighborTop, nWater) : 0.02;
    const yBotB = inB ? cornerTopY(map, nq, nr, (i + 1) % 6, neighborTop, nWater) : 0.02;
    const nEdge = Math.max(yBotA, yBotB);
    const drop = Math.min(yA, yB) - nEdge;
    const shoreEdge = inB && !isWater && nWater;
    let emit = true;
    if (isWater && (nWater || !inB)) emit = false;
    else if (drop < CLIFF_DROP && !(shoreEdge && drop > RAMP_DROP)) emit = false;
    else if (inB && !isWater && !nWater && Math.abs(cell.elev - map.getLocal(nq, nr).elev) < 0.07) emit = false;
    else if (inB && (yA + yB) * 0.5 < nEdge) emit = false;
    if (!emit) continue;
    walls++;
    if (drop >= CLIFF_DROP) trueWalls++;
    if (shoreEdge) {
      shoreWalls++;
      if (drop > maxShoreWallDrop) maxShoreWallDrop = drop;
    }
    if (inB && !isWater && !nWater && Math.abs(map.getLocal(nq, nr).elev - cell.elev) < 0.07) {
      lowDeltaWalls++;
    }
  }
});

// Worst attribute span at any shared vertex: 0 when welding is symmetric.
let worstAttrSpan = 0;
for (const g of groups.values()) {
  if (g.ys.length < 2 || g.spanCellY >= CLIFF_DROP) continue;
  const eSpan = Math.max(...g.elevs) - Math.min(...g.elevs);
  if (eSpan > worstAttrSpan) worstAttrSpan = eSpan;
}

console.log(
  JSON.stringify({
    worstAttrSpan,
    maxWallBottomGap,
    topGroups: groupsN,
    crackGroups,
    attrCracks,
    walls,
    trueWalls,
    shoreWalls,
    maxShoreWallDrop: +maxShoreWallDrop.toFixed(3),
    lowDeltaPairs,
    lowDeltaWalls,
    RAMP_DROP,
  }),
);
