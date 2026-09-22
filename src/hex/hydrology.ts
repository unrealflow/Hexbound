/**
 * Hydrology data layer (goals §2.4 G-Hydro, milestone M1 = S1 + S2):
 *
 * S1 Priority-Flood depression filling (Barnes et al. 2014, arXiv:1511.04463)
 *    over the D6 hex graph: ocean cells seed an ascending flood that raises
 *    every depression exactly to its spill level. Raised regions are lakes and
 *    a lake's level IS the spill elevation the flood reached — "lake surface =
 *    overflow elevation" falls out of the algorithm, no extra solve.
 * S2 Flow routing on the filled field: D6 steepest descent with a low-frequency
 *    noise tie-break for the flat plateaus the fill creates (white noise would
 *    zig-zag them), unresolved flats routed by multi-source BFS toward already
 *    routed cells, then drainage area accumulated over the receiver tree in
 *    topological order.
 *
 * Pure data: nothing here touches geometry, textures or gameplay semantics.
 * scripts/hydro-check.ts asserts H1 (every land cell drains to the ocean
 * through an acyclic tree) and H5 (lake invariants) on top of this output.
 */

import { AXIAL_DIRS } from './coords';
import { HexMap, Terrain } from './HexMap';

export interface LakeInfo {
  id: number;
  cells: number;
  level: number;
}

export interface HydrologyResult {
  /** Depression-filled elevation, same 0..1 scale as cell.elev. */
  filled: Float32Array;
  /** The pre-fill field the flood ran on (land-neighbor mean of elev, 0 on water). */
  hydroElev: Float32Array;
  /** Lake label per cell (-1 = not a lake). */
  lakeId: Int16Array;
  /** Spill elevation per lake id. */
  lakeLevel: Float32Array;
  lakes: LakeInfo[];
  /** D6 successor per cell (-1 on water only). Every land cell has one. */
  receiver: Int32Array;
  /** Drainage area in cells: 1 per land cell, accumulated downstream. */
  area: Float32Array;
  /** Strahler order on the receiver tree (water cells 0). */
  strahler: Int32Array;
  stats: {
    landCells: number;
    waterCells: number;
    raisedCells: number;
    lakeCells: number;
    maxStrahler: number;
    channelCells: number;
  };
}

/** A "depression" shallower than this is smoothing/quantization residue, not a lake. */
const LAKE_DEPTH_EPS = 0.008;
/** Drainage area (in cells) at which a cell becomes a river channel — goals
 *  §2.4 S3: ~2-4% of land cells channelled on the 40x32 map. */
export const CHANNEL_AREA_THRESHOLD = 16;
/** Hack-law channel half-width in cells: w = w0 * (A/A0)^0.45, ~0.2 at the
 *  source to ~1.5 at a large mouth (goals §2.4 S3). */
export function channelWidth(area: number): number {
  return Math.min(1.6, 0.2 * Math.pow(Math.max(1, area) / CHANNEL_AREA_THRESHOLD, 0.45));
}
/** Connected raised regions smaller than this are puddles, not lakes. */
const MIN_LAKE_CELLS = 3;

function isWaterT(t: number): boolean {
  return t === Terrain.ShallowWater || t === Terrain.DeepWater;
}

/** Integer-lattice hash, same family as mapgen's hash2. */
function tieHash(x: number, y: number, seed: number): number {
  let n = Math.imul(x + seed * 374761393, 668265263) ^ Math.imul(y, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Coherent low-frequency noise (~6 lattice periods across the map) for the
 *  flow tie-break: equal-filled cells drain as a body toward one side instead
 *  of salt-and-peppering the plateau with competing directions. */
function tieNoise(u: number, v: number, seed: number): number {
  const x = u * 6;
  const y = v * 6;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = tieHash(x0, y0, seed);
  const b = tieHash(x0 + 1, y0, seed);
  const c = tieHash(x0, y0 + 1, seed);
  const d = tieHash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Binary min-heap over (level, cellIndex), sized for one push per cell. */
class CellHeap {
  private lvl: Float64Array;
  private idx: Int32Array;
  private n = 0;

  constructor(capacity: number) {
    this.lvl = new Float64Array(capacity);
    this.idx = new Int32Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  push(lvl: number, cell: number): void {
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.lvl[p]! <= lvl) break;
      this.lvl[i] = this.lvl[p]!;
      this.idx[i] = this.idx[p]!;
      i = p;
    }
    this.lvl[i] = lvl;
    this.idx[i] = cell;
  }

  pop(): number {
    const top = this.idx[0]!;
    this.n--;
    if (this.n > 0) {
      const lvl = this.lvl[this.n]!;
      const cell = this.idx[this.n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let ml = lvl;
        if (l < this.n && this.lvl[l]! < ml) {
          m = l;
          ml = this.lvl[l]!;
        }
        if (r < this.n && this.lvl[r]! < ml) {
          m = r;
          ml = this.lvl[r]!;
        }
        if (m === i) break;
        this.lvl[i] = this.lvl[m]!;
        this.idx[i] = this.idx[m]!;
        i = m;
      }
      this.lvl[i] = lvl;
      this.idx[i] = cell;
    }
    return top;
  }
}

export function computeHydrology(map: HexMap, seed: number): HydrologyResult {
  const w = map.width;
  const h = map.height;
  const n = w * h;

  // Smoothed source field: the same unconditional land-neighbour mean that
  // cellTopY applies, so lake levels and (later) channel carving stay aligned
  // with the rendered surface. Water stays 0 = sea level.
  const hydroElev = new Float32Array(n);
  map.forEach((cell, lq, lr) => {
    if (isWaterT(cell.terrainId)) return;
    let sum = cell.elev;
    let cnt = 1;
    for (const d of AXIAL_DIRS) {
      const nq = lq + d.q;
      const nr = lr + d.r;
      if (!map.inBoundsLocal(nq, nr)) continue;
      const nb = map.getLocal(nq, nr);
      if (isWaterT(nb.terrainId)) continue;
      sum += nb.elev;
      cnt++;
    }
    hydroElev[map.index(lq, lr)] = sum / cnt;
  });

  // ---- S1: Priority-Flood ----
  // Each cell is pushed exactly once (marked closed on push). Ocean seeds at
  // level 0; border land cells seed at their own elevation so a depression
  // against the map edge still has a defined spill.
  const filled = new Float32Array(n);
  const closed = new Uint8Array(n);
  const heap = new CellHeap(n);
  map.forEach((cell, lq, lr) => {
    const i = map.index(lq, lr);
    if (isWaterT(cell.terrainId)) {
      filled[i] = 0;
      closed[i] = 1;
      heap.push(0, i);
    } else if (lq === 0 || lr === 0 || lq === w - 1 || lr === h - 1) {
      filled[i] = hydroElev[i]!;
      closed[i] = 1;
      heap.push(filled[i]!, i);
    }
  });
  while (heap.size > 0) {
    const i = heap.pop();
    const e = filled[i]!;
    const lq = i % w;
    const lr = (i - lq) / w;
    for (const d of AXIAL_DIRS) {
      const nq = lq + d.q;
      const nr = lr + d.r;
      if (!map.inBoundsLocal(nq, nr)) continue;
      const j = nr * w + nq;
      if (closed[j]) continue;
      closed[j] = 1;
      filled[j] = Math.max(hydroElev[j]!, e);
      heap.push(filled[j]!, j);
    }
  }

  // ---- Lake labelling: connected raised regions ----
  const lakeId = new Int16Array(n).fill(-1);
  const lakes: LakeInfo[] = [];
  {
    const visited = new Uint8Array(n);
    const members: number[] = [];
    const stack: number[] = [];
    for (let s = 0; s < n; s++) {
      if (visited[s] || filled[s]! - hydroElev[s]! <= LAKE_DEPTH_EPS) continue;
      members.length = 0;
      stack.length = 0;
      stack.push(s);
      visited[s] = 1;
      let level = 0;
      while (stack.length) {
        const i = stack.pop()!;
        members.push(i);
        if (filled[i]! > level) level = filled[i]!;
        const lq = i % w;
        const lr = (i - lq) / w;
        for (const d of AXIAL_DIRS) {
          const nq = lq + d.q;
          const nr = lr + d.r;
          if (!map.inBoundsLocal(nq, nr)) continue;
          const j = nr * w + nq;
          if (visited[j] || filled[j]! - hydroElev[j]! <= LAKE_DEPTH_EPS) continue;
          visited[j] = 1;
          stack.push(j);
        }
      }
      if (members.length < MIN_LAKE_CELLS) continue;
      const id = lakes.length;
      for (const i of members) lakeId[i] = id;
      lakes.push({ id, cells: members.length, level });
    }
  }
  const levels = new Float32Array(lakes.length);
  for (const l of lakes) levels[l.id] = l.level;

  // ---- S2a: steepest descent on the filled field ----
  const receiver = new Int32Array(n).fill(-1);
  const noise = new Float32Array(n);
  const tieSeed = seed | 0;
  map.forEach((_cell, lq, lr) => {
    noise[map.index(lq, lr)] = tieNoise((lq + 0.5) / w, (lr + 0.5) / h, tieSeed);
  });
  map.forEach((cell, lq, lr) => {
    const i = map.index(lq, lr);
    if (isWaterT(cell.terrainId)) return;
    let best = -1;
    let bestLvl = filled[i]!;
    let bestNoise = -1;
    for (const d of AXIAL_DIRS) {
      const nq = lq + d.q;
      const nr = lr + d.r;
      if (!map.inBoundsLocal(nq, nr)) continue;
      const j = nr * w + nq;
      const lj = filled[j]!;
      if (lj < bestLvl - 1e-9) {
        bestLvl = lj;
        best = j;
        bestNoise = noise[j]!;
      } else if (best >= 0 && Math.abs(lj - bestLvl) <= 1e-9 && noise[j]! > bestNoise) {
        best = j;
        bestNoise = noise[j]!;
      }
    }
    if (best >= 0 && bestLvl < filled[i]! - 1e-9) receiver[i] = best;
  });

  // ---- S2b: resolve filled plateaus (no strictly-lower neighbour) ----
  // Unresolved cells form connected components at one filled level (a neighbour
  // strictly below would have resolved them). Each component exits at a member
  // adjacent to an already-resolved cell whose filled is <= the component's own
  // level — the spill side. A resolved cell at that level drains strictly
  // downhill and can never re-enter the component, so the routed graph is
  // acyclic by construction; BFS inside the component just grows the tree from
  // that exit member.
  {
    const comp = new Int32Array(n).fill(-1);
    const compLevel: number[] = [];
    const compMembers: number[][] = [];
    for (let s0 = 0; s0 < n; s0++) {
      if (comp[s0] !== -1 || isWaterT(map.getLocal(s0 % w, Math.floor(s0 / w)).terrainId)) continue;
      if (receiver[s0] !== -1) continue;
      const id = compMembers.length;
      const members: number[] = [];
      const stack = [s0];
      comp[s0] = id;
      while (stack.length) {
        const i = stack.pop()!;
        members.push(i);
        const lq = i % w;
        const lr = (i - lq) / w;
        for (const d of AXIAL_DIRS) {
          const nq = lq + d.q;
          const nr = lr + d.r;
          if (!map.inBoundsLocal(nq, nr)) continue;
          const j = nr * w + nq;
          if (comp[j] !== -1 || receiver[j] !== -1) continue;
          if (Math.abs(filled[j]! - filled[i]!) > 1e-9) continue;
          comp[j] = id;
          stack.push(j);
        }
      }
      compLevel.push(filled[s0]!);
      compMembers.push(members);
    }
    for (let id = 0; id < compMembers.length; id++) {
      const members = compMembers[id]!;
      const level = compLevel[id]!;
      const onBorderCell = (i: number) => {
        const lq = i % w;
        const lr = (i - lq) / w;
        return lq === 0 || lr === 0 || lq === w - 1 || lr === map.height - 1;
      };
      // Exits: a member's neighbour at or below the plateau level that already
      // drains — a resolved cell, or a border-terminal member (the domain edge
      // can seal a depression; that cell keeps receiver -1 and must never be
      // pulled into the tree, or it closes a 2-cycle). Exit chains descend
      // strictly from a level <= the plateau's, so they never re-enter the
      // component; BFS tree edges stay flat inside it: acyclic by construction.
      const queue: number[] = [];
      for (const i of members) {
        const lq = i % w;
        const lr = (i - lq) / w;
        let bestTarget = -1;
        let bestLvl = Infinity;
        for (const d of AXIAL_DIRS) {
          const nq = lq + d.q;
          const nr = lr + d.r;
          if (!map.inBoundsLocal(nq, nr)) continue;
          const j = nr * w + nq;
          const borderTerminal = receiver[j] === -1 && onBorderCell(j);
          if (receiver[j] === -1 && !borderTerminal) continue; // still unrouted
          if (receiver[j] === i) continue; // would close a 2-cycle
          if (filled[j]! > level + 1e-9) continue; // upslope face, not the spill
          if (filled[j]! < bestLvl) {
            bestLvl = filled[j]!;
            bestTarget = j;
          }
        }
        if (bestTarget !== -1) {
          receiver[i] = bestTarget;
          queue.push(i);
        }
      }
      // Multi-root BFS over the remaining members; border terminals stay -1.
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head]!;
        const lq = i % w;
        const lr = (i - lq) / w;
        for (const d of AXIAL_DIRS) {
          const nq = lq + d.q;
          const nr = lr + d.r;
          if (!map.inBoundsLocal(nq, nr)) continue;
          const j = nr * w + nq;
          if (comp[j] !== id || receiver[j] !== -1 || onBorderCell(j)) continue;
          receiver[j] = i;
          queue.push(j);
        }
      }
    }
  }

  // ---- S2c: drainage area, accumulated over the receiver tree ----
  const area = new Float32Array(n);
  const donors = new Int32Array(n);
  let landCells = 0;
  let waterCells = 0;
  map.forEach((cell, lq, lr) => {
    const i = map.index(lq, lr);
    if (isWaterT(cell.terrainId)) {
      waterCells++;
      return;
    }
    landCells++;
    area[i] = 1;
    const r = receiver[i]!;
    if (r >= 0) donors[r]++;
  });
  {
    const order: number[] = [];
    map.forEach((cell, lq, lr) => {
      const i = map.index(lq, lr);
      if (!isWaterT(cell.terrainId) && donors[i] === 0) order.push(i);
    });
    for (let head = 0; head < order.length; head++) {
      const i = order[head]!;
      const r = receiver[i]!;
      if (r >= 0) {
        area[r]! += area[i]!;
        if (--donors[r]! === 0) order.push(r);
      }
    }
  }

  let raisedCells = 0;
  for (let i = 0; i < n; i++) {
    if (filled[i]! - hydroElev[i]! > LAKE_DEPTH_EPS) raisedCells++;
  }
  let lakeCells = 0;
  for (const l of lakes) lakeCells += l.cells;

  // ---- Strahler order on the receiver tree (same Kahn pass shape as area) ----
  const strahler = new Int32Array(n);
  const max1 = new Int32Array(n);
  const max2 = new Int32Array(n);
  let maxStrahler = 0;
  let channelCells = 0;
  for (let i = 0; i < n; i++) {
    if (isWaterT(map.getLocal(i % w, Math.floor(i / w)).terrainId)) continue;
    strahler[i] = 1;
  }
  {
    // Fresh donor counts: the area pass above consumed the old array.
    const donors2 = new Int32Array(n);
    map.forEach((cell, lq, lr) => {
      const i = map.index(lq, lr);
      if (isWaterT(cell.terrainId)) return;
      const r = receiver[i]!;
      if (r >= 0) donors2[r]++;
    });
    const order: number[] = [];
    map.forEach((cell, lq, lr) => {
      const i = map.index(lq, lr);
      if (!isWaterT(cell.terrainId) && donors2[i] === 0) order.push(i);
    });
    for (let head = 0; head < order.length; head++) {
      const i = order[head]!;
      const r = receiver[i]!;
      const si = strahler[i]!;
      if (r < 0) continue;
      if (si > max1[r]!) {
        max2[r] = max1[r]!;
        max1[r] = si;
      } else if (si > max2[r]!) {
        max2[r] = si;
      }
      if (--donors2[r]! === 0 && !isWaterT(map.getLocal(r % w, Math.floor(r / w)).terrainId)) {
        strahler[r] = max1[r]! + (max2[r]! === max1[r]! ? 1 : 0);
        order.push(r);
      }
    }
    for (let i = 0; i < n; i++) {
      if (strahler[i]! > maxStrahler) maxStrahler = strahler[i]!;
      if (strahler[i]! > 0 && area[i]! >= CHANNEL_AREA_THRESHOLD) channelCells++;
    }
  }

  return {
    filled,
    hydroElev,
    lakeId,
    lakeLevel: levels,
    lakes,
    receiver,
    area,
    strahler,
    stats: { landCells, waterCells, raisedCells, lakeCells, maxStrahler, channelCells },
  };
}
