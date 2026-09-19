/** CPU replica of ChunkMesher + hexTerrain.vert.glsl, checked for cracks and
 *  holes. It welds corner scalars the way the mesher does, replicates the
 *  vertex-shader displacement term for term, and then reports, for every world
 *  corner:
 *    - crackGroups: copies of one corner that no longer meet although they had
 *      the same welded height (the surface is torn and nothing fills it),
 *    - uncoveredSteps: corners split between two terraces where no wall was
 *      emitted to bridge them (the sky shows through).
 *  Exits 1 when either is non-zero, so it can gate a build.
 *  Usage: npx tsx scripts/crack-metric.ts
 */
import { generateMap } from '../src/hex/mapgen.ts';
import { HEX_SIZE, hexCornerOffset, axialToWorld } from '../src/hex/coords.ts';
import {
  CLIFF_DROP,
  ELEV_SCALE,
  MIN_WALL_DROP,
  WATER_Y,
  isWaterTerrain,
  isWaterLocal,
  cellTopY,
  cornerTopY,
  dispWeight,
  displaceLandY,
  rawElev,
  rawMountainW,
  rawForestW,
  sharedCornerIndex,
  weldCornerScalar,
  edgeNeighbour,
  avg7,
} from '../src/hex/terrainContinuity.ts';

const SEED = 20260916;
const map = generateMap({ seed: SEED, width: 40, height: 32 });

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface Corner {
  landW: number;
  mtnW: number;
  forestWv: number;
  /** CPU welded height, and the same height after the vertex shader. */
  y: number;
  yDisp: number;
  covered: boolean;
}

const groups = new Map<string, Corner[]>();
const keyOf = (x: number, z: number): string => `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`;

function addCorner(
  x: number,
  z: number,
  y: number,
  elevW: number,
  mwW: number,
  fwW: number,
  disp: number,
): void {
  const landW = smoothstep(0.02, 0.09, elevW) * disp;
  const mtnW = smoothstep(0, 0.14, mwW) * disp;
  const forestWv = smoothstep(0, 0.16, fwW) * disp;
  const c: Corner = {
    landW,
    mtnW,
    forestWv,
    y,
    yDisp: y + displaceLandY(x, z, elevW, mwW, disp, true),
    covered: false,
  };
  const k = keyOf(x, z);
  const arr = groups.get(k);
  if (arr) arr.push(c);
  else groups.set(k, [c]);
}

let walls = 0;
let trueWalls = 0;
let hairlineWalls = 0;
let skippedSteps = 0;
/** Edges that only get a wall because the rule looks at each end separately:
 *  one end is split into two terraces and the other is welded. The old rule
 *  measured the whole edge at once and cancelled every one of these, so this
 *  count is also the number of slits the mesh used to carry. */
let halfSplitBridged = 0;

map.forEach((cell, lq, lr) => {
  const isWater = isWaterTerrain(cell.terrainId);
  const yTopFlat = isWater ? WATER_Y : cell.elev * ELEV_SCALE;
  const { x: cxw, z: czw } = axialToWorld(cell.q, cell.r, HEX_SIZE);

  const cornerYs: number[] = [];
  const cornerDisp: number[] = [];
  for (let i = 0; i < 6; i++) {
    const c = hexCornerOffset(i, HEX_SIZE);
    cornerYs.push(cornerTopY(map, lq, lr, i, yTopFlat, isWater));
    cornerDisp.push(dispWeight(map, cxw + c.x, czw + c.z));
  }

  // Top fan: centre + six corners, exactly as the mesher emits them.
  let centerDisp = 0;
  for (let i = 0; i < 6; i++) centerDisp += cornerDisp[i]!;
  addCorner(
    cxw,
    czw,
    yTopFlat,
    avg7(map, lq, lr, rawElev),
    avg7(map, lq, lr, rawMountainW),
    avg7(map, lq, lr, rawForestW),
    centerDisp / 6,
  );
  for (let i = 0; i < 6; i++) {
    const c = hexCornerOffset(i, HEX_SIZE);
    addCorner(
      cxw + c.x,
      czw + c.z,
      cornerYs[i]!,
      weldCornerScalar(map, lq, lr, i, rawElev),
      weldCornerScalar(map, lq, lr, i, rawMountainW),
      weldCornerScalar(map, lq, lr, i, rawForestW),
      cornerDisp[i]!,
    );
  }

  // Side walls: same emission rule as the mesher, so the "covered" marks below
  // are the walls the real mesh has.
  for (let i = 0; i < 6; i++) {
    const nb = edgeNeighbour(map, lq, lr, i);
    if (!nb) continue;
    const nq = nb[0];
    const nr = nb[1];
    const inB = map.inBoundsLocal(nq, nr);
    const nWater = isWaterLocal(map, nq, nr);
    const yA = cornerYs[i]!;
    const yB = cornerYs[(i + 1) % 6]!;
    const c0 = hexCornerOffset(i, HEX_SIZE);
    const c1 = hexCornerOffset((i + 1) % 6, HEX_SIZE);
    const nCell = inB ? map.getLocal(nq, nr) : cell;
    const nTopFlat = inB && !nWater ? nCell.elev * ELEV_SCALE : WATER_Y;
    const nJ = inB ? sharedCornerIndex(map, nq, nr, cxw + c0.x, czw + c0.z) : 0;
    const nJ1 = inB ? sharedCornerIndex(map, nq, nr, cxw + c1.x, czw + c1.z) : 0;
    const yBotA = inB ? cornerTopY(map, nq, nr, nJ, nTopFlat, nWater) : WATER_Y;
    const yBotB = inB ? cornerTopY(map, nq, nr, nJ1, nTopFlat, nWater) : WATER_Y;
    if (!(isWater && (nWater || !inB))) {
      // Same per-end rule as the mesher: a half-split edge (one end split into
      // two terraces, the other welded to the mean) is a real opening and has to
      // be bridged, so the min/max test on the whole edge is not used here.
      const drop = Math.max(yA - yBotA, yB - yBotB);
      const wholeEdgeDrop = Math.min(yA, yB) - Math.max(yBotA, yBotB);
      if (drop > MIN_WALL_DROP) {
        if (wholeEdgeDrop <= MIN_WALL_DROP) halfSplitBridged++;
        walls++;
        if (drop >= CLIFF_DROP) trueWalls++;
        else hairlineWalls++;
        markCovered(cxw, czw, i);
      } else if (drop > 0) {
        skippedSteps++;
      }
    }
  }
});

function markCovered(cxw: number, czw: number, edge: number): void {
  for (const i of [edge, (edge + 1) % 6]) {
    const c = hexCornerOffset(i, HEX_SIZE);
    const arr = groups.get(keyOf(cxw + c.x, czw + c.z));
    if (arr) for (const v of arr) v.covered = true;
  }
}

let topGroups = 0;
let crackGroups = 0;
let uncoveredSteps = 0;
let worstWeightSpan = 0;
let worstCrack = 0;
const examples: string[] = [];

for (const arr of groups.values()) {
  if (arr.length < 2) continue;
  topGroups++;
  const wSpan = Math.max(
    Math.max(...arr.map((v) => v.landW)) - Math.min(...arr.map((v) => v.landW)),
    Math.max(...arr.map((v) => v.mtnW)) - Math.min(...arr.map((v) => v.mtnW)),
    Math.max(...arr.map((v) => v.forestWv)) - Math.min(...arr.map((v) => v.forestWv)),
  );
  const yCpuSpan = Math.max(...arr.map((v) => v.y)) - Math.min(...arr.map((v) => v.y));
  const yDispSpan = Math.max(...arr.map((v) => v.yDisp)) - Math.min(...arr.map((v) => v.yDisp));
  if (yCpuSpan <= 1e-6) {
    // Welded coplanar corners must still be coplanar after displacement.
    if (wSpan > worstWeightSpan) worstWeightSpan = wSpan;
    if (yDispSpan > 0.002) {
      crackGroups++;
      if (yDispSpan > worstCrack) worstCrack = yDispSpan;
      if (examples.length < 5) examples.push(`crack span=${yDispSpan.toFixed(4)} weightSpan=${wSpan.toFixed(4)}`);
    }
  } else if (yDispSpan > 0.002 && !arr.some((v) => v.covered)) {
    uncoveredSteps++;
    if (examples.length < 5) examples.push(`uncovered step span=${yDispSpan.toFixed(4)}`);
  }
}

const report = {
  seed: SEED,
  topGroups,
  crackGroups,
  uncoveredSteps,
  worstWeightSpan: +worstWeightSpan.toExponential(2),
  worstCrackSpan: +worstCrack.toFixed(4),
  walls,
  trueWalls,
  hairlineWalls,
  halfSplitBridged,
  skippedStepsUnderThreshold: skippedSteps,
  MIN_WALL_DROP,
};
console.log(JSON.stringify(report, null, 1));
examples.forEach((e) => console.log('worst:', e));

if (crackGroups > 0 || uncoveredSteps > 0) {
  console.error(`FAIL: ${crackGroups} torn corner(s), ${uncoveredSteps} uncovered step(s)`);
  process.exit(1);
}
console.log('OK: every shared corner is either coplanar or bridged by a wall');
