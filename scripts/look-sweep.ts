/** look-sweep — look-workflow §6 parameter sweep for P1 (composition).
 *  Renders each variant's elevation (grey, the shape truth) and biome colour
 *  side by side in one grid PNG + manifest.json, straight from generateMap —
 *  no renderer involved, so composition is judged on the data layer only.
 *  Usage: npx tsx scripts/look-sweep.ts [--seed 20260916] [--out _sweep-p1-chain]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateMap, type LookParams } from '../src/hex/mapgen';
import { Terrain } from '../src/hex/HexMap';
import { encodePng } from './png';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv;
const argOf = (n: string, d: string) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1]! : d);
const SEED = Number(argOf('--seed', '20260916'));
const OUT = join(__dirname, '..', 'docs', 'shots', argOf('--out', '_sweep-p1-chain'));
mkdirSync(OUT, { recursive: true });

const BASE: Partial<LookParams> = {
  chainCount: 3,
  chainAmp: 0.75,
  chainWidth: 3.5,
  baseKeep: 0.7,
  shoreExempt: 0.45,
  mountainGate: 0.5,
  desertElevMax: 0.42,
  spineBoostKeep: 0.3,
};

const VARIANTS: { tag: string; look: Partial<LookParams> }[] = [
  { tag: 'A0-legacy', look: { chainCount: 0, baseKeep: 1.0, desertElevMax: 1.0 } },
  { tag: 'A1-n2-amp55', look: { ...BASE, chainCount: 2 } },
  { tag: 'A2-n3-amp55', look: { ...BASE, chainAmp: 0.55 } },
  { tag: 'A3-n3-amp75', look: { ...BASE, chainAmp: 0.75 } },
  { tag: 'A4-n3-w30', look: { ...BASE, chainWidth: 3.0 } },
  { tag: 'A5-n3-w55', look: { ...BASE, chainWidth: 5.5 } },
  { tag: 'A6-n3-base60', look: { ...BASE, baseKeep: 0.6 } },
  { tag: 'A7-n3-gate40', look: { ...BASE, mountainGate: 0.4 } },
  { tag: 'A8-n3-desert36', look: { ...BASE, desertElevMax: 0.36 } },
  { tag: 'B1-n3-sk30', look: { ...BASE } },
  { tag: 'B2-n3-base80', look: { ...BASE, baseKeep: 0.8 } },
  { tag: 'B3-n4-amp70', look: { ...BASE, chainCount: 4, chainAmp: 0.7 } },
  { tag: 'B4-n3-amp85-w30', look: { ...BASE, chainAmp: 0.85, chainWidth: 3.0 } },
  { tag: 'B5-n2-amp80', look: { ...BASE, chainCount: 2, chainAmp: 0.8 } },
  { tag: 'B6-n3-sk45', look: { ...BASE, spineBoostKeep: 0.45 } },
  { tag: 'B7-n3-w45', look: { ...BASE, chainWidth: 4.5 } },
  { tag: 'B8-n3-gate42-des36', look: { ...BASE, mountainGate: 0.42, desertElevMax: 0.36 } },
  { tag: 'C1-n3-base58-sk12', look: { ...BASE, baseKeep: 0.58, spineBoostKeep: 0.12, chainAmp: 0.8 } },
  { tag: 'C2-n4-base58-sk12', look: { ...BASE, chainCount: 4, baseKeep: 0.58, spineBoostKeep: 0.12, chainAmp: 0.75 } },
  { tag: 'C3-n3-base62-sk20', look: { ...BASE, baseKeep: 0.62, spineBoostKeep: 0.2, chainAmp: 0.8 } },
  { tag: 'C4-n3-amp85-w30', look: { ...BASE, baseKeep: 0.58, spineBoostKeep: 0.12, chainAmp: 0.85, chainWidth: 3.0 } },
  { tag: 'C5-n4-w40-base62', look: { ...BASE, chainCount: 4, chainWidth: 4.0, baseKeep: 0.62, spineBoostKeep: 0.2, chainAmp: 0.75 } },
  { tag: 'C6-n3-des40', look: { ...BASE, baseKeep: 0.58, spineBoostKeep: 0.12, chainAmp: 0.8, desertElevMax: 0.4 } },
];

const BIOME_RGB: Record<number, [number, number, number]> = {
  [Terrain.Plains]: [156, 197, 112],
  [Terrain.Grassland]: [120, 176, 92],
  [Terrain.Desert]: [222, 202, 138],
  [Terrain.Tundra]: [176, 186, 178],
  [Terrain.Hills]: [142, 124, 90],
  [Terrain.Mountains]: [168, 168, 172],
  [Terrain.ShallowWater]: [92, 178, 190],
  [Terrain.DeepWater]: [24, 52, 106],
};

const CELL = 6; // px per cell
const PANELS = 2; // elev grey | biome colour
const PANEL_W = 40 * CELL;
const rows = VARIANTS.length;
const W = PANEL_W * PANELS;
const H = rows * 32 * CELL;
const img = new Uint8Array(W * H * 4);

rows &&
  VARIANTS.forEach((variant, col) => {
    const map = generateMap({ seed: SEED, look: variant.look });
    map.forEach((cell, lq, lr) => {
      // Panel 1: elevation grey (shape truth)
      const v = Math.round(Math.min(1, Math.max(0, cell.elev)) * 255);
      for (let py = 0; py < CELL; py++) {
        for (let px = 0; px < CELL; px++) {
          const y = col * 32 * CELL + lr * CELL + py;
          const x = lq * CELL + px;
          const o = (y * W + x) * 4;
          img[o] = v;
          img[o + 1] = v;
          img[o + 2] = v;
          img[o + 3] = 255;
          // Panel 2: biome colour
          const x2 = PANEL_W + lq * CELL + px;
          const [r, g, b] = BIOME_RGB[cell.terrainId]!;
          const o2 = (y * W + x2) * 4;
          img[o2] = r;
          img[o2 + 1] = g;
          img[o2 + 2] = b;
          img[o2 + 3] = 255;
        }
      }
    });
  });

writeFileSync(join(OUT, 'grid.png'), encodePng(W, H, img));
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ seed: SEED, note: 'left panel = elev grey, right panel = biome colour', variants: VARIANTS }, null, 1),
);
console.log(`OK: ${rows} variants -> ${join(OUT, 'grid.png')} (${W}x${H})`);
