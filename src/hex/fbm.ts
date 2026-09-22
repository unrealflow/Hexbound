/**
 * Bake-time sub-cell detail noise (CPU side of goals §2.3-B "sub-grid source
 * data"). The packed fields are one value per cell pre-filtered with the
 * (1-d/r)^3 kernel, so their spectrum is empty above the cell frequency and
 * iso-contours (forest edges, biome bands) still wander along the hex lattice.
 * This module supplies the zero-mean high-frequency band that HexMap.bakeRGBA
 * adds AFTER the kernel accumulation: the wide kernel owns the C1 low band,
 * this owns the sub-cell band, and the two never convolve.
 *
 * The rotation and the per-octave matrix mirror noise.glsl's fbmRotate() /
 * fbm2() so the band cannot line up with the world axes or the hex lattice —
 * the same constants the shader noise uses to avoid exactly that artifact.
 */

// noise.glsl fbmRotate() = mat2(0.8525, 0.5227, -0.5227, 0.8525), applied here
// in row-major form: [x', z'] = R * [x, z].
const ROT = [0.8525, -0.5227, 0.5227, 0.8525];
// noise.glsl per-octave matrix mat2(1.6, 1.2, -1.2, 1.6) in row-major form.
const OCT = [1.6, -1.2, 1.2, 1.6];

/** GLSL hash21 (fract-based), evaluated in doubles — deterministic on CPU. */
function hash21(px: number, py: number): number {
  const fx = frac(px * 0.1031);
  const fy = frac(py * 0.1031);
  const fz = frac(px * 0.1031);
  const d = fx * (fy + 33.33) + fy * (fz + 33.33) + fz * (fx + 33.33);
  const x = fx + d;
  const y = fy + d;
  const z = fz + d;
  return frac((x + y) * z);
}

function frac(x: number): number {
  return x - Math.floor(x);
}

/** Quintic value noise on a unit lattice, shifted by an integer seed. */
function valueNoise(px: number, py: number, seed: number): number {
  const sx = px + seed * 127.1;
  const sy = py + seed * 311.7;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash21(x0, y0);
  const b = hash21(x0 + 1, y0);
  const c = hash21(x0, y0 + 1);
  const d = hash21(x0 + 1, y0 + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Two-octave value FBM in [0,1] at ~1 unit lattice wavelength. */
function fbm2(px: number, py: number, seed: number): number {
  let x = ROT[0]! * px + ROT[1]! * py;
  let y = ROT[2]! * px + ROT[3]! * py;
  let v = 0.5 * valueNoise(x, y, seed);
  const nx = OCT[0]! * x + OCT[1]! * y;
  const ny = OCT[2]! * x + OCT[3]! * y;
  v += 0.25 * valueNoise(nx, ny, seed + 101);
  return v / 0.75;
}

/**
 * Domain-warped rotated FBM detail band, zero-mean in [-1, 1].
 *
 * `freq` is the first-octave frequency in world units^-1 (wavelength ~1/freq,
 * so pick freq ~0.85 for a ~1.2 wu band — under half a cell). The warp field
 * runs two octaves lower and its offset stays under a quarter of the band's
 * wavelength, so the warp folds iso-contours off the lattice without aliasing
 * the band itself.
 */
export function detailBand(x: number, z: number, seed: number, freq: number): number {
  const w1 = fbm2(x * 0.31 + 5.1, z * 0.31 + 1.3, seed + 7);
  const w2 = fbm2(x * 0.31 + 23.7, z * 0.31 + 9.2, seed + 13);
  const px = (x + (w1 - 0.5) * 0.6) * freq;
  const pz = (z + (w2 - 0.5) * 0.6) * freq;
  let ox = ROT[0]! * px + ROT[1]! * pz;
  let oz = ROT[2]! * px + ROT[3]! * pz;
  let v = 0.5 * valueNoise(ox, oz, seed);
  const nx = OCT[0]! * ox + OCT[1]! * oz;
  const ny = OCT[2]! * ox + OCT[3]! * oz;
  v += 0.25 * valueNoise(nx, ny, seed + 101);
  return 2 * (v / 0.75) - 1;
}
