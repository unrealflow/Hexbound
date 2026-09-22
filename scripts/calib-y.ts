/** One-shot calibration: displaced world Y distribution + forestCover histogram. */
import { generateMap } from '../src/hex/mapgen.ts';
import { HEX_SIZE, hexCornerOffset, axialToWorld } from '../src/hex/coords.ts';
import {
  ELEV_SCALE,
  isWaterTerrain,
  cornerTopY,
  rawElev,
  rawMountainW,
  weldCornerScalar,
  avg7,
  displaceLandY,
  dispWeight,
} from '../src/hex/terrainContinuity.ts';

const map = generateMap({ seed: 20260916, width: 40, height: 32 });
const ys: number[] = [];
const mountainYs: number[] = [];
let peak = -Infinity;

map.forEach((cell, lq, lr) => {
  const isWater = isWaterTerrain(cell.terrainId);
  if (isWater) return;
  const yTopFlat = cell.elev * ELEV_SCALE;
  const { x: cxw, z: czw } = axialToWorld(cell.q, cell.r, HEX_SIZE);
  const elevC = avg7(map, lq, lr, rawElev);
  const mC = avg7(map, lq, lr, rawMountainW);
  const yc = yTopFlat + 0.015 + displaceLandY(cxw, czw, elevC, mC, dispWeight(map, cxw, czw), true);
  ys.push(yc);
  peak = Math.max(peak, yc);
  if (mC > 0.3) mountainYs.push(yc);
  for (let i = 0; i < 6; i++) {
    const c = hexCornerOffset(i, HEX_SIZE);
    const y = cornerTopY(map, lq, lr, i, yTopFlat, isWater);
    const eW = weldCornerScalar(map, lq, lr, i, rawElev);
    const mW = weldCornerScalar(map, lq, lr, i, rawMountainW);
    const yv = y + displaceLandY(cxw + c.x, czw + c.z, eW, mW, dispWeight(map, cxw + c.x, czw + c.z), true);
    ys.push(yv);
    peak = Math.max(peak, yv);
    if (mW > 0.3) mountainYs.push(yv);
  }
});

const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))]!;
};
const fmt = (v: number) => +v.toFixed(3);

const cover: number[] = [];
map.forEach((c) => {
  if (!isWaterTerrain(c.terrainId)) cover.push(c.forestCover);
});
const midCover = cover.filter((v) => v > 0.05 && v < 0.95).length;

console.log(
  JSON.stringify({
    landVerts: ys.length,
    min: fmt(Math.min(...ys)),
    p50: fmt(q(ys, 50)),
    p90: fmt(q(ys, 90)),
    p95: fmt(q(ys, 95)),
    p99: fmt(q(ys, 99)),
    max: fmt(Math.max(...ys)),
    peak: fmt(peak),
    snowBand_70_90: [fmt(peak * 0.7), fmt(peak * 0.9)],
    mountainVerts: mountainYs.length,
    mountainMin: mountainYs.length ? fmt(Math.min(...mountainYs)) : null,
    mountainP50: mountainYs.length ? fmt(q(mountainYs, 50)) : null,
    mountainMax: mountainYs.length ? fmt(Math.max(...mountainYs)) : null,
    coverSamples: cover.length,
    coverInOpenRange: midCover,
  }),
);
