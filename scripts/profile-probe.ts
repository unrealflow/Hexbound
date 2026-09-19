/** Transect probe: sample heightAt along straight lines and report the largest
 *  single-step height delta at fine resolution — a discontinuity (wall/terrace)
 *  shows up as a step far above max_slope * step. */
import { generateMap } from '../src/hex/mapgen';
import { heightAt } from '../src/hex/terrainContinuity';

const map = generateMap({ seed: 20260916, width: 40, height: 32 });
const STEP = 0.01;
const lines: [number, number, number, number][] = [
  [-24, -12, 24, -12],  // E-W through the south escarpment band
  [-20, -10, 20, 10],   // diagonal through the massif
  [0, -14, 0, 14],      // N-S through the peak
  [-24, 8, 24, 8],      // E-W through the north coast
];
let worst = 0, worstAt = '', worstSlope = 0;
for (const [x0, z0, x1, z1] of lines) {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / STEP);
  let prev = heightAt(map, x0, z0);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const y = heightAt(map, x, z);
    // Skip the off-map sentinel so map borders do not count as terrain jumps.
    if (y < -100 || prev < -100) { prev = y; continue; }
    const d = Math.abs(y - prev);
    if (d > worst) { worst = d; worstAt = `(${x.toFixed(2)},${z.toFixed(2)})`; }
    worstSlope = Math.max(worstSlope, d / STEP);
    prev = y;
  }
}
console.log(JSON.stringify({
  step: STEP,
  maxStepDelta: +worst.toFixed(5),
  maxStepDeltaAt: worstAt,
  maxSlopePerUnit: +worstSlope.toFixed(2),
  verdict: worst < 0.05 ? 'CONTINUOUS: largest fine-step delta is slope-driven, no vertical jumps' : 'DISCONTINUITY SUSPECTED',
}, null, 1));

if (worst >= 0.05) {
  console.error(`FAIL: cross-section jump ${worst.toFixed(4)} at ${worstAt} exceeds the smooth-terrain bound`);
  process.exit(1);
}
console.log('OK: every transect is a continuous curve (no vertical jumps)');
