/** Pointy-top axial hex coordinates (q, r), s = -q-r. */

export type Axial = { q: number; r: number };

export const HEX_SIZE = 1.0;

const SQRT3 = Math.sqrt(3);

/** World XZ from axial (y is elevation, handled elsewhere). */
export function axialToWorld(q: number, r: number, size = HEX_SIZE): { x: number; z: number } {
  const x = size * SQRT3 * (q + r / 2);
  const z = size * (3 / 2) * r;
  return { x, z };
}

/** Fractional axial from world XZ. */
export function worldToAxialFrac(x: number, z: number, size = HEX_SIZE): { q: number; r: number } {
  const q = ((SQRT3 / 3) * x - (1 / 3) * z) / size;
  const r = ((2 / 3) * z) / size;
  return { q, r };
}

/** Cube-round then back to axial. */
export function axialRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}

export function worldToAxial(x: number, z: number, size = HEX_SIZE): Axial {
  const f = worldToAxialFrac(x, z, size);
  return axialRound(f.q, f.r);
}

export function axialDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** Pointy-top corner offsets (index 0..5), relative to center, y=0 plane. */
export function hexCornerOffset(i: number, size = HEX_SIZE): { x: number; z: number } {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: size * Math.cos(angle), z: size * Math.sin(angle) };
}

export const AXIAL_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbors(q: number, r: number): Axial[] {
  return AXIAL_DIRS.map((d) => ({ q: q + d.q, r: r + d.r }));
}
