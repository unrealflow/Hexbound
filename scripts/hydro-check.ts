/** hydro:check — data-consistency gate for the hydrology layer (goals §2.4,
 *  acceptance H1 + H5). Runs the S1/S2 pipeline inside generateMap and asserts:
 *    H1  every land cell's receiver chain reaches a terminal within n steps —
 *        the ocean, or a land cell on the map border (a depression the domain
 *        edge seals drains off-map there). No cycles, no suspended interior
 *        flow, receivers exactly cover the map;
 *    H5  every labelled lake is a real depression raised to one spill level,
 *        with an outlet at that level on its rim.
 *  Area conservation is asserted as the H1 bookkeeping twin: every drainage
 *  unit must reach a terminal exactly once. */
import { generateMap } from '../src/hex/mapgen';
import { Terrain } from '../src/hex/HexMap';
import { CHANNEL_AREA_THRESHOLD, channelWidth } from '../src/hex/hydrology';

const argv = process.argv;
const seedArg = argv.indexOf('--seed') >= 0 ? Number(argv[argv.indexOf('--seed') + 1]) : NaN;
const seed = Number.isFinite(seedArg) ? seedArg : 20260916;

const map = generateMap({ seed, width: 40, height: 32 });
const hydro = map.hydrology;
if (!hydro) {
  console.error('FAIL: generateMap produced no hydrology layer');
  process.exit(1);
}
const { filled, hydroElev, lakeId, lakeLevel, lakes, receiver, area, strahler, stats } = hydro;
const w = map.width;
const n = w * map.height;
const isWater = (i: number) => {
  const cell = map.getLocal(i % w, Math.floor(i / w));
  return cell.terrainId === Terrain.ShallowWater || cell.terrainId === Terrain.DeepWater;
};
const failures: string[] = [];

// ---- H1a: receiver coverage — water has none; land has one unless it is a
// border terminal (the domain edge can seal a depression) ----
const onBorder = (i: number) => {
  const lq = i % w;
  const lr = Math.floor(i / w);
  return lq === 0 || lr === 0 || lq === w - 1 || lr === map.height - 1;
};
let badCoverage = 0;
for (let i = 0; i < n; i++) {
  if (isWater(i)) {
    if (receiver[i] !== -1) badCoverage++;
  } else if (receiver[i] === -1 && !onBorder(i)) {
    badCoverage++;
  }
}
if (badCoverage > 0) failures.push(`H1a: ${badCoverage} interior cell(s) with no receiver`);

// ---- H1b: every land chain terminates at water or a border cell within n steps ----
let maxChain = 0;
let suspended = 0;
for (let i = 0; i < n; i++) {
  if (isWater(i)) continue;
  let steps = 0;
  let cur = i;
  while (steps <= n) {
    const r = receiver[cur]!;
    if (r === -1) break;
    cur = r;
    steps++;
  }
  if (steps > n) {
    suspended++; // cycle
  } else if (receiver[cur] === -1 && !isWater(cur) && !onBorder(cur)) {
    suspended++; // dead end on interior land
  } else if (steps > maxChain) {
    maxChain = steps;
  }
}
if (suspended > 0) failures.push(`H1b: ${suspended} chain(s) cycle or end on interior land`);

// ---- H1c: area conservation — every unit reaches a terminal exactly once ----
let terminalArea = 0;
for (let i = 0; i < n; i++) {
  if (isWater(i)) continue;
  const r = receiver[i]!;
  if (r === -1 && onBorder(i)) terminalArea += area[i]!;
  else if (r !== -1 && isWater(r)) terminalArea += area[i]!;
}
const areaDrift = Math.abs(terminalArea - stats.landCells);
if (areaDrift > 1e-6) {
  failures.push(`H1c: terminal area ${terminalArea.toFixed(3)} != land cells ${stats.landCells}`);
}

// ---- H2: the channel network exists and its width grows downstream ----
// (H2 acceptance: >=1 main stem with Strahler >= 3 reaching the sea; width
// monotone non-decreasing along every downstream channel chain.)
if (stats.channelCells >= 20 && stats.maxStrahler < 3) {
  failures.push(`H2: maxStrahler ${stats.maxStrahler} < 3 with ${stats.channelCells} channel cells`);
}
let widthViolations = 0;
let mainStemOrder = 0;
for (let i = 0; i < n; i++) {
  if (isWater(i) || area[i]! < CHANNEL_AREA_THRESHOLD) continue;
  const r = receiver[i]!;
  if (r >= 0 && !isWater(r) && area[r]! >= CHANNEL_AREA_THRESHOLD) {
    if (channelWidth(area[r]!) < channelWidth(area[i]!) - 1e-9) widthViolations++;
    if (strahler[i]! === stats.maxStrahler) mainStemOrder++;
  }
}
if (widthViolations > 0) failures.push(`H2: ${widthViolations} width monotonicity violation(s)`);

// ---- H5: lake invariants ----
const lakeReport: { id: number; cells: number; level: number; outlet: boolean }[] = [];
for (const lake of lakes) {
  let badBed = 0;
  let aboveLevel = 0;
  let outlet = false;
  for (let i = 0; i < n; i++) {
    if (lakeId[i] !== lake.id) continue;
    if (filled[i]! - hydroElev[i]! <= 0.008) badBed++;
    if (filled[i]! > lake.level + 1e-4) aboveLevel++;
    const lq = i % w;
    const lr = Math.floor(i / w);
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const) {
      const nq = lq + dq;
      const nr = lr + dr;
      if (nq < 0 || nr < 0 || nq >= w || nr >= map.height) continue;
      const j = nr * w + nq;
      if (lakeId[j] !== lake.id && filled[j]! >= lake.level - 1e-3) outlet = true;
    }
  }
  if (badBed > 0) failures.push(`H5: lake ${lake.id} has ${badBed} cell(s) not actually raised`);
  if (aboveLevel > 0) failures.push(`H5: lake ${lake.id} has ${aboveLevel} cell(s) above its spill level`);
  if (!outlet) failures.push(`H5: lake ${lake.id} has no rim outlet at its own level`);
  lakeReport.push({ id: lake.id, cells: lake.cells, level: +lake.level.toFixed(4), outlet });
}

const report = {
  seed,
  landCells: stats.landCells,
  waterCells: stats.waterCells,
  raisedCells: stats.raisedCells,
  lakes: lakeReport,
  lakeCells: stats.lakeCells,
  maxStrahler: stats.maxStrahler,
  channelCells: stats.channelCells,
  mainStemCells: mainStemOrder,
  maxChain,
  terminalArea: +terminalArea.toFixed(3),
};
console.log(JSON.stringify(report, null, 1));

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log(
  `OK: ${stats.landCells} land cells drain to terminals as a tree (max chain ${maxChain}); ` +
    `channel network Strahler ${stats.maxStrahler} over ${stats.channelCells} cells; ` +
    `${lakes.length} lake(s), ${stats.lakeCells} lake cells at consistent spill levels`,
);
